'use strict';
/*
 * Reads invoice files on the server.
 *  - PDFs: text, the font and size of each line, and edit history (PDF.js)
 *  - Images: text and the height of each line (Tesseract OCR). The first image read downloads
 *    Tesseract's English language data (about 10 MB), so it needs internet once.
 * Both libraries are installed with `npm install`. If they're missing, reading fails gracefully and
 * the customer can type the details instead.
 */

const PDF_TIMEOUT_MS = 20000;
const OCR_TIMEOUT_MS = 60000;
const MAX_PIXELS = 40e6;            // e.g. 8000 x 5000. Stops "image bombs" that use huge amounts of memory
const MAX_SIDE = 12000;

// Errors with a message that's safe and useful to show the customer
const userErr = msg => Object.assign(new Error(msg), { userMessage: msg });

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(userErr(message)), ms); })]).finally(() => clearTimeout(t));
}

// ---------------------------------------------------------------- PDF
async function readPdf(buf) { return withTimeout(readPdfInner(buf), PDF_TIMEOUT_MS, 'Reading the PDF took too long.'); }
async function readPdfInner(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buf);
  const raw = Buffer.from(buf).toString('latin1');
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, maxImageSize: 16e6 }).promise;
  let text = '';
  const lines = [];
  const push = cur => {
    if (!cur || !cur.text.trim()) return;
    const top = Object.entries(cur.fonts).sort((a, b) => b[1] - a[1])[0];
    lines.push({ text: cur.text.trim(), font: top ? top[0] : null, size: cur.size || 12 });
  };
  for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
    const page = await doc.getPage(i);
    try { await page.getOperatorList(); } catch (e) { /* fonts still usable by id */ }
    const content = await page.getTextContent();
    let cur = null;
    for (const it of content.items) {
      if (typeof it.str !== 'string') continue;
      text += it.str + (it.hasEOL ? '\n' : ' ');
      if (!cur) cur = { text: '', fonts: {}, size: 0 };
      cur.text += it.str;
      if (it.str.trim()) {
        let fname = it.fontName;
        try { const fo = page.commonObjs.get(it.fontName); if (fo && fo.name) fname = fo.name; } catch (e) { /* font not loaded */ }
        cur.fonts[fname] = (cur.fonts[fname] || 0) + it.str.length;
        cur.size = Math.max(cur.size, Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10);
      }
      if (it.hasEOL) { push(cur); cur = null; }
    }
    push(cur);
    text += '\n';
  }
  const meta = { producer: '', created: null, modified: null, eofCount: (raw.match(/%%EOF/g) || []).length };
  try {
    const md = await doc.getMetadata();
    meta.producer = md.info.Producer || md.info.Creator || '';
    meta.created = pdfDate(md.info.CreationDate);
    meta.modified = pdfDate(md.info.ModDate);
  } catch (e) { /* no metadata */ }
  await doc.destroy();
  return { text, lines, meta };
}
// "D:20261114091200+11'00'" -> "2026-11-14T09:12:00"
function pdfDate(d) {
  const m = String(d || '').match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}` : null;
}

// ---------------------------------------------------------------- Images (OCR)
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      // errorHandler stops Tesseract from throwing errors the server can't catch (which would crash it)
      return createWorker('eng', 1, { errorHandler: e => console.error('Text recognition error:', String(e)) });
    })().catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}
async function resetWorker() {
  const p = workerPromise; workerPromise = null;
  try { const w = await p; if (w) await w.terminate(); } catch (e) { /* already gone */ }
}
// Image type and size from the file header, without decoding the image
function imageInfo(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1], len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
    return { type: 'jpeg', width: 0, height: 0 };
  }
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { type: 'webp' };
  if (b.length > 2 && b.toString('latin1', 0, 2) === 'BM') return { type: 'bmp', width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) };
  if (b.length > 6 && b.toString('latin1', 0, 3) === 'GIF') return { type: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  return null;
}

// Only one photo is read at a time, so many uploads can't overload the server
let ocrQueue = Promise.resolve();
function readImage(buf) {
  const job = ocrQueue.then(() => readImageInner(buf));
  ocrQueue = job.catch(() => {});
  return job;
}
async function readImageInner(buf) {
  const b = Buffer.from(buf);
  const info = imageInfo(b);
  if (!info) throw userErr('This file type is not supported. Use a photo (JPG or PNG) or a PDF.');
  if (info.width && info.height && (info.width > MAX_SIDE || info.height > MAX_SIDE || info.width * info.height > MAX_PIXELS)) {
    throw userErr('This image is too large to read. Try a smaller photo.');
  }
  const worker = await getWorker();
  let data;
  try { ({ data } = await withTimeout(worker.recognize(b), OCR_TIMEOUT_MS, 'Reading the photo took too long.')); }
  catch (e) { await resetWorker(); throw userErr('This image could not be read.'); }
  const lines = (data.lines || [])
    .map(l => ({ text: String(l.text || '').trim(), font: null, size: capHeight(l) }))
    .filter(l => l.text);
  return { text: data.text || '', lines, editor: imageEditor(buf) };
}
// Typical height of capital letters and digits in a line. Whole-line height would change with
// letters that hang below the line (p, g, y), which isn't a sign of editing.
function capHeight(line) {
  const h = [];
  (line.words || []).forEach(w => (w.symbols || []).forEach(s => {
    if (/^[A-Z0-9]$/.test(s.text) && !/^[QJ]$/.test(s.text) && s.bbox) h.push(s.bbox.y1 - s.bbox.y0);
  }));
  if (!h.length) return line.bbox ? line.bbox.y1 - line.bbox.y0 : 0;
  h.sort((a, b) => a - b);
  return h[Math.floor(h.length / 2)];
}

// Editing software named in the image file's details
function imageEditor(buf) {
  const head = Buffer.from(buf).subarray(0, 262144).toString('latin1');
  const m = head.match(/Adobe Photoshop|GIMP|Canva|Pixelmator|Affinity Photo|Paint\.NET|Picsart|Photopea/i);
  return m ? m[0] : null;
}

module.exports = { readPdf, readImage, imageEditor, imageInfo };
