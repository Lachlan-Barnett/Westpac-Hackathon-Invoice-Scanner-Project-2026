'use strict';
/*
 * Westpac Scam Protect prototype server.
 *   npm install      (once)
 *   npm start        then open http://localhost:3000
 *
 * Serves the app and runs every scam check through the JSON API below.
 *
 * Security
 *  - Listens on this computer only (127.0.0.1). Set HOST=0.0.0.0 to share it on your network.
 *  - Every API call needs the session cookie the app gets when it loads (HttpOnly, SameSite=Strict).
 *  - POST requests must be JSON (Content-Type: application/json), which other websites can't send
 *    without the browser asking this server first - and this server never says yes.
 *  - Rate limits per IP address, and stricter limits for reading files and reporting scams.
 *  - Security headers (Content Security Policy, no framing, no referrer, no sniffing).
 *  - Only the app and sample files are served; the server's code and database are not.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const checks = require('./checks');
const services = require('./services');
const reader = require('./reader');
const db = require('./db');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 20 * 1024 * 1024; // invoices are sent as base64
const DEMO_CUSTOMER_ID = 1;        // the prototype signs every browser in as the demo customer

// Only these files are served to the browser
const FILES = {
  '/': 'index.html', '/index.html': 'index.html', '/apis.js': 'apis.js',
  '/sample-invoice.png': 'sample-invoice.png', '/sample-invoice-genuine.txt': 'sample-invoice-genuine.txt', '/sample-invoice-scam.txt': 'sample-invoice-scam.txt',
  '/sample-invoice.pdf': 'sample-invoice.pdf', '/sample-invoice-edited.pdf': 'sample-invoice-edited.pdf',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };

const SECURITY_HEADERS = {
  // The app uses inline scripts and onclick handlers, so 'unsafe-inline' is needed for scripts;
  // everything else is locked to this server (no outside scripts, images, connections or frames).
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

function send(res, status, body, type, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8' }, SECURITY_HEADERS, extra || {}));
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const httpError = (status, message) => Object.assign(new Error(message), { status });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(httpError(413, 'File too large (20 MB maximum).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(httpError(400, 'Invalid request.'));
        resolve(v);
      } catch (e) { reject(httpError(400, 'Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- Sessions (cookie set when the app loads)
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function newSessionCookie() {
  const sid = crypto.randomBytes(32).toString('hex');
  db.createSession(sid, DEMO_CUSTOMER_ID);
  return `sp_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`;
}
function sessionFor(req) {
  const sid = parseCookies(req.headers.cookie).sp_sid;
  if (!sid || !/^[a-f0-9]{64}$/.test(sid)) return null;
  const s = db.session(sid);
  if (!s) return null;
  db.touchSession(sid);
  return s;
}

// ---------------------------------------------------------------- Rate limits (per IP address, per minute)
const LIMITS = { api: 300, read: 15, report: 20 };
const hits = new Map();
function rateLimited(ip, bucket) {
  const key = bucket + '|' + ip, t = Date.now();
  let h = hits.get(key);
  if (!h || t - h.start > 60000) { h = { start: t, n: 0 }; hits.set(key, h); }
  h.n++;
  return h.n > LIMITS[bucket];
}
setInterval(() => { const t = Date.now(); for (const [k, h] of hits) if (t - h.start > 60000) hits.delete(k); db.pruneSessions(); }, 60000).unref();

// ---------------------------------------------------------------- API routes (ctx = { customerId })
const routes = {
  'GET /api/health': async () => ({ ok: true, mock: services.CONFIG.MOCK }),

  // The signed-in customer's profile and identity (KYC) record
  'GET /api/customer/me': async (b, ctx) => services.kyc.profile(ctx.customerId) || { status: 404, error: 'Customer not found.' },

  // Live name check while typing
  'POST /api/payment/namecheck': async b => {
    const r = await checks.nameCheck(b.to || {}, !!b.isBusiness);
    return r.found ? { found: true, name: r.name, sameBank: r.sameBank, items: r.items, flags: r.flags } : { found: false };
  },
  // Name check + Scam Risk Score for the review screen
  'POST /api/payment/review': async (b, ctx) => {
    const r = await checks.reviewPayment(b);
    if (r.risk) db.logCheck(ctx.customerId, 'payment', r.risk.score, r.risk.score >= 50 ? 'high' : r.risk.score >= 30 ? 'medium' : 'low');
    return r;
  },
  // What the answers to the 3 scam questions mean
  'POST /api/payment/answers': async b => checks.answersVerdict(b),

  // Read an invoice file (PDF or image) sent as base64
  'POST /api/invoice/read': async b => {
    const buf = Buffer.from(String(b.data || ''), 'base64');
    if (!buf.length) return { status: 400, error: 'No file received.' };
    const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
    try {
      if (isPdf) { const r = await reader.readPdf(buf); return { kind: 'PDF', text: r.text, doc: { lines: r.lines, meta: r.meta } }; }
      const r = await reader.readImage(buf);
      return { kind: 'IMG', text: r.text, doc: { lines: r.lines, meta: null, editor: r.editor } };
    } catch (e) {
      console.error('Could not read invoice:', e.message);
      return { status: 422, error: e.userMessage || "We couldn't read this invoice automatically." };
    }
  },
  // Every invoice check
  'POST /api/invoice/analyze': async (b, ctx) => {
    const r = await checks.analyzeInvoice(b);
    db.logCheck(ctx.customerId, 'invoice', null, r.level);
    return r;
  },

  'POST /api/message/check': async b => checks.checkMessage(b.text),
  'POST /api/plan/start': async b => checks.startPlan(b),
  // Report an account or PayID as a scam (identity-verified customers, once per account)
  'POST /api/intel/report': async (b, ctx) => services.intel.report(b.key, ctx.customerId, b.name),
};

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip, 'api')) return send(res, 429, { error: 'Too many requests. Please wait a minute and try again.' });

  let handler = routes[`${req.method} ${url.pathname}`];
  if (!handler && req.method === 'GET' && url.pathname.startsWith('/api/bpay/')) {
    const code = decodeURIComponent(url.pathname.slice('/api/bpay/'.length));
    handler = async () => services.bpay.biller(code);
  }
  if (!handler) return send(res, 404, { error: 'Not found' });

  try {
    let ctx = {};
    if (url.pathname !== '/api/health') {
      const s = sessionFor(req);
      if (!s) return send(res, 401, { error: 'Your session has ended. Reload the page to continue.' });
      ctx = { customerId: s.customer_id };
    }
    if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return send(res, 415, { error: 'Requests must be JSON.' });
    }
    if (url.pathname === '/api/invoice/read' && rateLimited(ip, 'read')) return send(res, 429, { error: "You're uploading a lot of invoices. Please wait a minute." });
    if (url.pathname === '/api/intel/report' && rateLimited(ip, 'report')) return send(res, 429, { error: 'Too many reports. Please wait a minute.' });

    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await handler(body, ctx);
    if (out && out.status && (out.error || out.message)) return send(res, out.status, { error: out.error || out.message, ok: false });
    send(res, 200, out);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server.' });
  }
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'Bad request', 'text/plain; charset=utf-8'); }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  const file = FILES[url.pathname];
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  fs.readFile(path.join(ROOT, file), (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    // Loading the app starts a session if there isn't a valid one
    const extra = file === 'index.html' && !sessionFor(req) ? { 'Set-Cookie': newSessionCookie() } : undefined;
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream', extra);
  });
});
server.requestTimeout = 120000;
server.headersTimeout = 30000;

// Safety net: log unexpected errors instead of stopping the server
process.on('uncaughtException', e => console.error('Unexpected error (server still running):', e && e.message ? e.message : e));
process.on('unhandledRejection', e => console.error('Unexpected error (server still running):', e && e.message ? e.message : e));

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
    console.log(`Westpac Scam Protect running at http://${shown}:${PORT}`);
    console.log(HOST === '127.0.0.1' ? 'Only this computer can connect. Set HOST=0.0.0.0 to share it on your network.' : `Listening on ${HOST}: other devices on your network can connect.`);
    console.log(services.CONFIG.MOCK ? 'Using the demo database (MOCK mode): ' + db.DB_FILE : 'Using real services (MOCK=false).');
  });
}
module.exports = server;
