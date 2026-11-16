// Westpac Hackathon 2026 - Invoice Check (business-to-business payments) prototype backend
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const gemini = require("./lib/gemini");
const abr = require("./lib/abr");
const db = require("./lib/db");
const U = require("./lib/util");
const { runChecks, verdict, templateSummary, caseSummary, logVerification, velocity, threshold, fmtBsb, fmtAcc } = require("./lib/checks");
const invoiceSeed = require("./data/invoices.json");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SAMPLES = path.join(__dirname, "public/samples");
const hash = b => crypto.createHash("sha1").update(b).digest("hex");
// Recognise the demo invoice images by content, so demo mode works without an AI key
const demoByHash = Object.fromEntries(invoiceSeed.map(i => [hash(fs.readFileSync(path.join(SAMPLES, i.file))), i.fields]));
const CUSTOMER = { name: "Coomera Coffee Roasters Pty Ltd", short: "Coomera Coffee Roasters", abn: "45627048281" };

/* ---------- App data ---------- */
app.get("/api/status", (req, res) => {
  const n = t => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  res.json({ ai: gemini.enabled(), model: gemini.enabled() ? gemini.model() : null, abrLive: abr.enabled(), threshold: threshold(),
    db: { businesses: n("businesses"), accounts: n("bank_accounts"), reports: n("scam_reports"), invoices: n("invoices"), cases: n("fraud_cases") } });
});

app.get("/api/home", (req, res) => {
  res.json({
    customer: CUSTOMER, threshold: threshold(),
    accounts: db.all("SELECT * FROM customer_accounts ORDER BY id"),
    recent: db.all("SELECT * FROM transfers ORDER BY created_at DESC LIMIT 8"),
    unpaid: db.get("SELECT COUNT(*) AS n FROM invoices WHERE status = 'Unpaid'").n
  });
});

app.get("/api/payees", (req, res) => {
  res.json(db.all(`SELECT p.*, b.trading_names, b.entity_name, b.abn_status,
      (SELECT kyc_status FROM bank_accounts a WHERE a.bsb = p.bsb AND a.account_number = p.account_number) AS kyc_status
    FROM saved_payees p LEFT JOIN businesses b ON b.abn = p.abn ORDER BY p.nickname`));
});

app.get("/api/invoices", (req, res) => {
  res.json(db.all("SELECT id, invoice_number, business_name, abn, amount_due, due_date, received_at, received_from, image, status, scenario FROM invoices ORDER BY CASE status WHEN 'Unpaid' THEN 0 ELSE 1 END, received_at DESC"));
});

// Is this business already known (saved payee / business register)?
app.get("/api/lookup", async (req, res) => {
  const abn = U.digits(req.query.abn);
  const valid = U.abnValid(abn);
  const business = valid ? await abr.lookup(abn) : null;
  const saved = abn ? db.get("SELECT * FROM saved_payees WHERE abn = ?", [abn]) : null;
  res.json({ abn, valid, business, saved });
});

/* ---------- Step 1: read an invoice ---------- */
app.post("/api/extract", upload.single("invoice"), async (req, res) => {
  try {
    let buffer, mime, invoiceId = req.body.invoiceId ? Number(req.body.invoiceId) : null, stored = null;
    if (invoiceId) {
      const inv = db.get("SELECT * FROM invoices WHERE id = ?", [invoiceId]);
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      buffer = fs.readFileSync(path.join(SAMPLES, inv.image)); mime = "image/png"; stored = JSON.parse(inv.fields);
    } else if (req.file) {
      if (!/^image\/|^application\/pdf$/.test(req.file.mimetype)) return res.status(400).json({ error: "Please upload a PDF, PNG or JPG invoice." });
      buffer = req.file.buffer; mime = req.file.mimetype;
      console.log(`Invoice received: ${req.file.originalname} (${(buffer.length / 1e6).toFixed(2)} MB)`);
      stored = demoByHash[hash(buffer)] || null;
    } else return res.status(400).json({ error: "No invoice uploaded." });

    if (gemini.enabled()) {
      try { return res.json({ source: "ai", model: gemini.model(), fields: await gemini.extractInvoice(buffer, mime), invoiceId }); }
      catch (e) {
        console.error("AI extraction failed:", e.message);
        const why = /high demand|overloaded|try again|quota|rate|timed out/i.test(e.message) ? "The AI service is busy right now" : "AI couldn't read this invoice";
        if (stored) return res.json({ source: "demo", warning: `${why}, so we used the saved invoice details.`, fields: stored, invoiceId });
        return res.json({ source: "manual", fields: {}, warning: `${why}. Please type the details, or try again in a minute.` });
      }
    }
    if (stored) return res.json({ source: "demo", fields: stored, invoiceId });
    res.json({ source: "manual", fields: {}, warning: "AI isn't switched on (no Gemini key), so please type the invoice details." });
  } catch (e) { console.error(e); res.status(500).json({ error: "Something went wrong reading the invoice." }); }
});

/* ---------- Step 2: assess the payment ---------- */
const assessments = new Map();   // id -> { level, amount, fields, ... } (server enforces the result at payment time)
const newId = () => crypto.randomBytes(8).toString("hex");

app.post("/api/assess", async (req, res) => {
  try {
    const f = req.body.fields || {};
    const x = { ...f, subtotal: U.num(f.subtotal), gst: U.num(f.gst), total: U.num(f.total), deposit: U.num(f.deposit), amount_due: U.num(f.amount_due) || U.num(f.total) };
    if (!(x.amount_due > 0)) return res.status(400).json({ error: "Please enter the amount to pay." });
    if (U.digits(x.bsb).length !== 6 || U.digits(x.account_number).length < 6) return res.status(400).json({ error: "Please enter a valid BSB and account number." });
    const vel = velocity(x);
    const id = newId();
    const payee = x.business_name || x.account_name;

    // Small payment and nothing unusual -> no checks, no flags
    if (!vel.isLarge && !vel.flagged) {
      assessments.set(id, { mode: "quick", level: "none", x, invoiceId: req.body.invoiceId || null, created: Date.now() });
      return res.json({ id, mode: "quick", payee, amount: x.amount_due, amountText: U.money(x.amount_due), threshold: vel.threshold });
    }

    // Large payment, or a suspicious run of payments -> full Invoice Check
    const { checks, reg, acct } = await runChecks(x);
    let v = verdict(checks);
    let summary = templateSummary(v.level, checks, x, reg, acct), summarySource = "template";
    if (gemini.enabled()) {
      try {
        const ai = await gemini.explain(v.level, checks, x);
        const reasons = ai.reasons.join("; ");
        if (ai.risk === "high") checks.push({ label: "AI risk review", title: "AI flagged a high scam risk", status: "warn", detail: reasons || "The combination of signals matches a known scam pattern.", source: `AI risk review (${gemini.model()})` });
        else if (ai.risk === "medium") checks.push({ label: "AI risk review", title: "AI noted some risk", status: "info", detail: reasons || "Some signals worth a second look.", source: `AI risk review (${gemini.model()})` });
        else checks.push({ label: "AI risk review", title: "AI found no scam pattern", status: "pass", detail: reasons || "Nothing in the overall picture matches a known scam pattern.", source: `AI risk review (${gemini.model()})` });
        const nv = verdict(checks);
        if (nv.level !== v.level) { v = nv; summary = templateSummary(v.level, checks, x, reg, acct); }
        else v = nv;
        if (ai.summary) { summary = ai.summary; summarySource = "ai"; }
      } catch (e) { console.warn("AI review failed, using rules only:", e.message); }
    }
    const reason = vel.isLarge ? `Payments of ${U.money(vel.threshold)} or more are checked automatically.` : "This payment was checked because of unusual recent transfer activity.";
    assessments.set(id, { mode: "check", level: v.level, score: v.score, x, checks, invoiceId: req.body.invoiceId || null, created: Date.now() });
    logVerification(x, v, summary);
    res.json({
      id, mode: "check", reason, level: v.level, score: v.score, summary, summarySource, checks,
      payee: reg?.trading_names?.split(",")[0] || reg?.entity_name || payee, payeePhone: reg?.phone || null,
      amount: x.amount_due, amountText: U.money(x.amount_due),
      caseSummary: v.level === "red" ? caseSummary(v, checks, x) : null
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "Verification failed." }); }
});

/* ---------- Step 3: pay (server refuses red results) ---------- */
app.post("/api/pay", (req, res) => {
  const a = assessments.get(req.body.id);
  if (!a) return res.status(400).json({ error: "Please check the payment again before paying." });
  if (a.level === "red") return res.status(403).json({ error: "This payment was stopped by Invoice Check. Please talk to our fraud team." });
  if (a.level === "amber" && !req.body.confirmed) return res.status(400).json({ error: "Please confirm with the business first." });
  const x = a.x, from = db.get("SELECT * FROM customer_accounts WHERE id = ?", [Number(req.body.fromId) || 1]);
  if (from.balance < x.amount_due) return res.status(400).json({ error: "Not enough funds in this account." });
  const payee = x.business_name || x.account_name;
  db.run("UPDATE customer_accounts SET balance = balance - ? WHERE id = ?", [x.amount_due, from.id]);
  db.run(`INSERT INTO transfers (created_at,payee,abn,bsb,account_number,amount,reference,status,check_level) VALUES (?,?,?,?,?,?,?,?,?)`,
    [new Date().toISOString(), payee, U.digits(x.abn), U.digits(x.bsb), U.digits(x.account_number), x.amount_due, x.reference || x.invoice_number || "", "Sent", a.mode === "quick" ? "not needed" : a.level]);
  if (a.invoiceId) db.run("UPDATE invoices SET status = 'Paid' WHERE id = ?", [a.invoiceId]);
  if (req.body.savePayee && U.digits(x.abn) && !db.get("SELECT 1 FROM saved_payees WHERE abn = ?", [U.digits(x.abn)]))
    db.run(`INSERT INTO saved_payees (nickname,abn,account_name,bsb,account_number,added_on) VALUES (?,?,?,?,?,?)`, [payee, U.digits(x.abn), x.account_name || payee, U.digits(x.bsb), U.digits(x.account_number), db.daysAgo(0)]);
  db.save(); assessments.delete(req.body.id);
  res.json({ ok: true, receipt: "WBC" + Math.floor(Math.random() * 9e8 + 1e8), from: from.name, balance: from.balance - x.amount_due });
});

/* ---------- Report a transfer / request a fraud-team call ---------- */
app.post("/api/report", (req, res) => {
  const a = assessments.get(req.body.id);
  if (!a) return res.status(400).json({ error: "Nothing to report." });
  const kind = req.body.kind === "callback" ? "Fraud team callback" : "Customer report";
  const x = a.x;
  const findings = (a.checks || []).filter(c => c.status === "fail" || c.status === "warn").map(c => `${c.title}: ${c.detail}`).join("\n");
  db.run(`INSERT INTO fraud_cases (created_at,kind,payee,abn,bsb,account_number,amount,level,score,findings,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [new Date().toISOString(), kind, x.business_name || x.account_name, U.digits(x.abn), U.digits(x.bsb), U.digits(x.account_number), x.amount_due, a.level, a.score || null, findings, "Open"]);
  const caseId = db.get("SELECT MAX(id) AS id FROM fraud_cases").id;
  if (a.invoiceId) db.run("UPDATE invoices SET status = 'Reported' WHERE id = ?", [a.invoiceId]);
  db.save();
  res.json({ ok: true, caseId: "FC-" + String(caseId).padStart(5, "0"), kind });
});

/* ---------- Diagnostic ---------- */
app.get("/api/test-ai", async (req, res) => {
  if (!gemini.enabled()) return res.json({ ok: false, problem: "No GEMINI_API_KEY. Add it at /staff.html#settings" });
  try { const r = await gemini.extractInvoice(fs.readFileSync(path.join(SAMPLES, "invoice_genuine.png")), "image/png", true); res.json({ ok: true, model: r.model, extracted: r.fields, rawReply: r.raw }); }
  catch (e) { res.json({ ok: false, model: gemini.model(), error: e.message }); }
});

/* ---------- Settings: API keys + threshold (saved to .env, applied immediately) ---------- */
const ENV_FILE = path.join(__dirname, ".env");
const SETTINGS = ["GEMINI_API_KEY", "GEMINI_MODEL", "ABR_GUID", "LARGE_PAYMENT_THRESHOLD"];
const SECRET = ["GEMINI_API_KEY", "ABR_GUID"];
const mask = v => !v ? "" : v.length <= 8 ? "••••" : v.slice(0, 4) + "••••••••" + v.slice(-4);
const isLocal = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
app.get("/api/settings", (req, res) => {
  res.json({ GEMINI_API_KEY: mask(process.env.GEMINI_API_KEY), GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.8-flash", ABR_GUID: mask(process.env.ABR_GUID),
    LARGE_PAYMENT_THRESHOLD: threshold(), ai: gemini.enabled(), abrLive: abr.enabled() });
});
app.post("/api/settings", (req, res) => {
  if (!isLocal(req)) return res.status(403).json({ error: "Settings can only be changed on the computer running the app." });
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : fs.readFileSync(path.join(__dirname, ".env.example"), "utf8");
  for (const k of SETTINGS) {
    const v = (req.body[k] ?? "").toString().trim();
    if (!v || v.includes("••")) continue;
    const val = v === "-" && SECRET.includes(k) ? "" : v;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${val}`) : text.trimEnd() + `\n${k}=${val}\n`;
    process.env[k] = val;
  }
  fs.writeFileSync(ENV_FILE, text);
  console.log(`  Settings saved. AI: ${gemini.enabled() ? "ON" : "OFF"} · ABN Lookup: ${abr.enabled() ? "LIVE" : "bank database"} · Large payment: ${U.money(threshold())}`);
  res.json({ ok: true, ai: gemini.enabled(), abrLive: abr.enabled(), threshold: threshold() });
});

/* ---------- Staff: browse and edit the bank database (open /staff.html) ---------- */
const TABLES = {
  businesses: { order: "entity_name", cols: ["abn","entity_name","trading_names","entity_type","abn_status","abn_registered","gst_registered","acn","address","state","postcode","phone","website","email_domain","industry"] },
  bank_accounts: { order: "bank_name", cols: ["bsb","account_number","bank_name","account_name","account_type","linked_abn","kyc_status","kyc_verified_on","opened_on","unique_senders_7d","outflow_24h_pct"] },
  saved_payees: { order: "nickname", cols: ["nickname","abn","account_name","bsb","account_number","added_on"] },
  invoices: { order: "received_at DESC", cols: [] },
  transfers: { order: "created_at DESC", cols: [] },
  scam_reports: { order: "reported_on DESC", cols: ["type","value","source","reported_on","description"] },
  fraud_cases: { order: "id DESC", cols: [] },
  verifications: { order: "id DESC", cols: [] },
  customer_accounts: { order: "id", cols: [] }
};
app.get("/api/db/:table", (req, res) => {
  const t = TABLES[req.params.table]; if (!t) return res.status(404).json({ error: "Unknown table" });
  const rows = db.all(`SELECT rowid AS _rowid, * FROM ${req.params.table} ORDER BY ${t.order} LIMIT 500`);
  if (req.params.table === "invoices") rows.forEach(r => delete r.fields);
  res.json(rows);
});
app.post("/api/db/:table", (req, res) => {
  const name = req.params.table, t = TABLES[name];
  if (!t || !t.cols.length) return res.status(400).json({ error: "Can't add to this table" });
  const row = { ...req.body };
  for (const c of ["abn", "linked_abn", "bsb", "account_number"]) if (row[c]) row[c] = U.digits(row[c]);
  if (name === "scam_reports" && ["account", "abn", "phone"].includes(row.type)) row.value = U.digits(row.value);
  if (name === "businesses" && !U.abnValid(row.abn)) return res.status(400).json({ error: "That ABN fails the ATO checksum." });
  if (name === "businesses" && !row.email_domain && row.website) row.email_domain = row.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const cols = t.cols.filter(c => row[c] !== undefined && row[c] !== "");
  try {
    db.run(`INSERT OR REPLACE INTO ${name} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map(c => row[c]));
    db.save(); res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete("/api/db/:table/:rowid", (req, res) => {
  if (!TABLES[req.params.table]) return res.status(404).json({ error: "Unknown table" });
  db.run(`DELETE FROM ${req.params.table} WHERE rowid = ?`, [Number(req.params.rowid)]); db.save(); res.json({ ok: true });
});
app.post("/api/db-reset", async (req, res) => { await db.init({ reset: true }); assessments.clear(); res.json({ ok: true }); });

const PORT = process.env.PORT || 3000;
db.init().then(() => app.listen(PORT, () => {
  console.log(`\n  Invoice Check running at http://localhost:${PORT}`);
  console.log(`  AI (Gemini): ${gemini.enabled() ? "ON (" + gemini.model() + ")" : "OFF - demo mode (add a key at /staff.html#settings)"}`);
  console.log(`  ABN Lookup:  ${abr.enabled() ? "LIVE ABR + bank database" : "bank database (add ABR_GUID for the live register)"}`);
  console.log(`  Large payments: ${U.money(threshold())} and over get the full check`);
  console.log(`  Staff console: http://localhost:${PORT}/staff.html\n`);
}));
