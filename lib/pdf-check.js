// Looks inside a PDF file for signs it was edited after it was made. No AI needed:
//  - which program made it, and which program last saved it (PDF editors vs accounting software)
//  - created vs modified dates
//  - incremental saves: every time a PDF is changed and saved "on top", another %%EOF is added
//  - XMP edit history (several programs saved the file)
const zlib = require("zlib");

// Programs used to change existing PDFs. Invoices from accounting software (Xero, MYOB, QuickBooks, Word...) aren't in this list.
const EDITORS = [
  ["acrobat pro", "Adobe Acrobat"], ["acrobat standard", "Adobe Acrobat"], ["adobe acrobat", "Adobe Acrobat"], ["pdfescape", "PDFescape"], ["sejda", "Sejda PDF editor"],
  ["smallpdf", "Smallpdf"], ["ilovepdf", "iLovePDF"], ["pdf-xchange", "PDF-XChange Editor"], ["foxit phantompdf", "Foxit PDF Editor"], ["foxit pdf editor", "Foxit PDF Editor"],
  ["nitro", "Nitro PDF"], ["pdfelement", "PDFelement"], ["wondershare", "PDFelement"], ["pdffiller", "pdfFiller"], ["dochub", "DocHub"], ["inkscape", "Inkscape"],
  ["libreoffice draw", "LibreOffice Draw"], ["pdf candy", "PDF Candy"], ["pdf2go", "PDF2Go"], ["sodapdf", "Soda PDF"], ["soda pdf", "Soda PDF"], ["photoshop", "Photoshop"]
];

// PDF text strings: (literal) with escapes, or <hex>, possibly UTF-16
function pdfString(raw) {
  if (!raw) return "";
  let s;
  if (raw[0] === "<") {
    const hex = raw.slice(1, -1).replace(/\s/g, "");
    s = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex").toString("latin1");
  } else {
    s = raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, c) => /^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "", f: "" }[c] ?? c));
  }
  if (s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) { // UTF-16BE
    let out = ""; for (let i = 2; i + 1 < s.length; i += 2) out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1)); s = out;
  }
  return s.replace(/\0/g, "").trim();
}
const field = (text, name) => { const m = text.match(new RegExp("/" + name + "\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)")); return m ? pdfString(m[1]) : ""; };
const xmp = (text, tag) => { const m = text.match(new RegExp("<" + tag + ">([^<]+)</" + tag + ">")) || text.match(new RegExp(tag + "=\"([^\"]+)\"")); return m ? m[1].trim() : ""; };

// D:20261114093000+10'00' -> Date
function pdfDate(s) {
  const m = String(s || "").match(/(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/);
  if (!m) { const d = new Date(s); return isNaN(d) ? null : d; }
  const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00", z, oh = "00", om = "00"] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}${z && z !== "Z" ? `${z}${oh}:${om}` : "Z"}`;
  const dt = new Date(iso); return isNaN(dt) ? null : dt;
}
const editorOf = s => { const l = String(s || "").toLowerCase(); const e = EDITORS.find(([k]) => l.includes(k)); return e ? e[1] : null; };
const fmt = d => d.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Australia/Brisbane" });
const gap = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : m < 2880 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`; };

function analysePdf(buf) {
  if (!buf || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  let text = buf.toString("latin1");
  // Metadata can be inside compressed object streams: unpack the small ones too
  const streams = [];
  const re = /stream\r?\n/g; let m, n = 0;
  while ((m = re.exec(text)) && n < 200) {
    const start = m.index + m[0].length, end = text.indexOf("endstream", start);
    if (end < 0) break;
    if (end - start < 2_000_000) { try { streams.push(zlib.inflateSync(buf.subarray(start, end)).toString("latin1")); } catch { /* not Flate, or images */ } }
    n++; re.lastIndex = end;
  }
  const all = text + "\n" + streams.filter(s => /\/Producer|\/Creator|xmp|ObjStm|\/ModDate/i.test(s)).join("\n");

  const producer = field(all, "Producer") || xmp(all, "pdf:Producer");
  const creator = field(all, "Creator") || xmp(all, "xmp:CreatorTool");
  const created = pdfDate(field(all, "CreationDate") || xmp(all, "xmp:CreateDate"));
  const modified = pdfDate(field(all, "ModDate") || xmp(all, "xmp:ModifyDate"));
  const linearized = /\/Linearized\s/.test(text.slice(0, 2048));
  const eofs = (text.match(/%%EOF/g) || []).length;
  const saves = Math.max(0, eofs - 1 - (linearized ? 1 : 0)); // extra saves on top of the original
  const agents = Array.from(new Set(Array.from(all.matchAll(/stEvt:softwareAgent(?:>|=")([^<"]+)/g)).map(x => x[1].trim())));

  const signs = [];
  const editor = editorOf(producer) || editorOf(creator);
  const later = created && modified && modified - created > 120000;
  // Made with one program, then saved with a PDF editor (a business that makes invoices in an editor is fine)
  const editedWith = editorOf(producer) && creator && !editorOf(creator) ? editorOf(producer) : null;
  if (editedWith) signs.push(`It was made with ${creator}, then saved with ${editedWith}, a program used to change existing PDFs`);
  if (saves > 0) signs.push(`The PDF was changed and saved again after it was first made (${saves} extra save${saves > 1 ? "s" : ""}${editor && !editedWith ? `, using ${editor}` : ""})`);
  if (later) signs.push(`It was modified ${gap(modified - created)} after it was created (${fmt(created)} → ${fmt(modified)})`);
  if (agents.length > 1) signs.push(`Its edit history lists ${agents.length} different programs (${agents.slice(0, 3).join(", ")})`);

  // One sign on its own can be innocent (re-saving a PDF). Two signs, or an editor plus a later change, is strong evidence.
  const strong = !!editor && (saves > 0 || later || agents.length > 1);
  return {
    producer, creator, created: created ? created.toISOString() : null, modified: modified ? modified.toISOString() : null,
    saves, editor, signs, level: !signs.length ? "pass" : strong || signs.length >= 2 ? "fail" : "warn"
  };
}

// Invoice Check row for the PDF (null when the invoice wasn't a PDF)
function pdfCheck(p) {
  if (!p) return null;
  const src = "PDF file analysis";
  const label = "Checking the PDF file";
  if (p.level === "pass") return { label, title: "PDF hasn't been edited", status: "pass", detail: `Made with ${p.creator || p.producer || "unknown software"}${p.created ? ` on ${fmt(new Date(p.created))}` : ""}, with no later changes.`, source: src };
  if (p.level === "warn") return { label, title: "PDF may have been changed", status: "warn", detail: p.signs.join(". ") + ".", source: src };
  return { label, title: "PDF was edited after it was made", status: "fail", detail: p.signs.join(". ") + ". Scammers edit real invoices to change the bank details.", source: src, crit: true };
}

module.exports = { analysePdf, pdfCheck };
