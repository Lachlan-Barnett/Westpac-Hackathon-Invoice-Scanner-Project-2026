// API for the phone banking app (public/index.html, which calls these routes through public/apis.js).
// Every check runs on the invoice-check backend: Gemini reads invoices (lib/gemini.js), the 9 Invoice Check
// checks run against the bank database (lib/checks.js), and name checks, scam reports and PayIDs come from
// the same database (lib/db.js + lib/app-data.js).
//
//  Route                          What it does
//  GET  /api/health               Is the server running? (and is AI on)
//  POST /api/payment/namecheck    Name on the account (Confirmation of Payee), PayID lookup, scam reports
//  POST /api/payment/review       Name check + Scam Risk Score
//  POST /api/payment/answers      What the answers to the 3 scam questions mean
//  POST /api/invoice/read         Reads a PDF or photo with Gemini (or the saved demo details)
//  POST /api/invoice/prepare      The details read from the invoice, as the app's form fields
//  POST /api/invoice/analyze      Invoice Check (lib/checks.js) shown as the app's checklist
//  POST /api/message/check        Scam signs in a text or email
//  POST /api/plan/start           Big payment plan rules
//  POST /api/intel/report         Report an account or PayID as a scam
//  GET  /api/customer/me          The signed-in customer's profile and identity (KYC) record
//  GET  /api/bpay/:code           BPAY biller lookup
const express = require("express");
const crypto = require("crypto");
const gemini = require("./gemini");
const abr = require("./abr");
const db = require("./db");
const U = require("./util");
const { runChecks, verdict, templateSummary, logVerification } = require("./checks");
const { CUSTOMER } = require("./app-data");

const BIG = 2000;          // "big payment" threshold for the payment questions and plans
const USUAL = 480;         // the demo customer's typical payment
const PLAN_MARGIN = 1.1;   // a plan covers up to 10% more than the planned amount
const QUESTIONS = 3;
const NEW_ACCOUNT_DAYS = 60;
const REPORTS_PER_HOUR = 10;
const scamWords = ["new account", "new bank", "updated details", "urgent", "overdue", "final notice", "ato", "tax debt", "crypto", "bitcoin", "gift card", "safe account", "refund", "investment"];

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, one, many) => n === 1 ? one : many;
const digits = U.digits;
const normId = s => String(s || "").trim().toLowerCase().replace(/\s/g, "").slice(0, 254);
const parseAmt = s => { const n = parseFloat(String(s || "").replace(/[$,\s]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const fmtBsb = b => { const x = digits(b).slice(0, 6); return x.length > 3 ? x.slice(0, 3) + "-" + x.slice(3) : x; };
const daysSince = iso => (Date.now() - new Date(iso).getTime()) / db.DAY;
const isWestpacBsb = bsb => /^(03|73)/.test(digits(bsb));
const normName = n => String(n || "").slice(0, 200).toLowerCase().replace(/\b(pty|ltd|limited|proprietary|the|trading as|t\/as|co|company|inc|llc)\b/g, " ").replace(/[^a-z0-9]/g, "");
// match | close | no_match (how Confirmation of Payee services describe results)
function compareNames(entered, actual) {
  const a = normName(entered), b = normName(actual);
  if (!a || !b) return "no_match";
  if (a === b) return "match";
  if (U.lev(a, b) / Math.max(a.length, b.length) <= 0.2 || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a)))) return "close";
  return "no_match";
}

/* ---------- Bank database lookups ---------- */
const account = key => db.get("SELECT * FROM bank_accounts WHERE bsb || account_number = ?", [key]);
function cop({ bsb, acc, name }) {
  const r = account(digits(bsb) + digits(acc));
  const sameBank = r ? /westpac/i.test(r.bank_name || "") : isWestpacBsb(bsb);
  if (!r) return { result: "unavailable", sameBank };
  const out = { result: compareNames(name, r.account_name), sameBank };
  if (sameBank) out.accountType = /^personal/i.test(r.account_type || "") ? "personal" : "business";
  return out;
}
function payid(id) {
  const r = db.get("SELECT * FROM payids WHERE payid = ?", [normId(id)]);
  return r ? { found: true, name: r.holder_name, type: r.payid_type, accountKey: r.account_key } : { found: false };
}
// reports = confirmed reports (fraud team, AFCX, Scamwatch) + reports from app customers
function intel(key) {
  const k = normId(key), p = payid(k), acctKey = p.found ? p.accountKey : k;
  const confirmed = db.get("SELECT COUNT(*) AS n FROM scam_reports WHERE type = 'account' AND value = ?", [acctKey]).n;
  const customers = db.get("SELECT COUNT(*) AS n FROM customer_reports WHERE key IN (?, ?)", [k, acctKey]).n;
  const a = account(acctKey);
  const newAccount = !!(a && (daysSince(a.opened_on) < NEW_ACCOUNT_DAYS || (a.unique_senders_7d >= 10 && /^personal/i.test(a.account_type || ""))));
  return { reports: confirmed + customers, confirmed: confirmed > 0, newAccount };
}

function reportText(n, confirmed, what) {
  if (confirmed) return `<b>This ${what} has been reported as a scam</b>, and our fraud team has confirmed it. We strongly recommend you don't pay it.`;
  return `<b>${n} ${plural(n, "customer has", "customers have")} reported this ${what} as a possible scam.</b> ${plural(n, "This report hasn't", "These reports haven't")} been confirmed yet, so check directly with the person or business before you pay.`;
}

/* ---------- Name check ---------- */
// to: { type: 'bsb', name, bsb, acc } or { type: 'payid', payid }
function nameCheck(to, isBusiness) {
  to = { type: to.type, name: String(to.name || "").trim().slice(0, 140), bsb: String(to.bsb || "").slice(0, 10), acc: String(to.acc || "").slice(0, 12), payid: String(to.payid || "").slice(0, 254) };
  const items = [], flags = {};
  const add = (level, html) => items.push({ level, html });
  let c = null, pid = null, key, name = to.name;
  if (to.type === "payid") {
    key = normId(to.payid);
    pid = payid(key);
    if (!pid.found) return { found: false, key };
    name = pid.name;
  } else {
    key = digits(to.bsb) + digits(to.acc);
    c = cop({ bsb: to.bsb, acc: to.acc, name: to.name });
  }
  const i = intel(key);
  if (c) {
    if (c.result === "match") { add("ok", `✓ <b>Name matches.</b> This account belongs to ${esc(to.name)}.`); flags.match = true; }
    else if (c.result === "close") { add("warn", `<b>Close match.</b> The name on this account is similar to "${esc(to.name)}", but not exactly the same. Check the spelling with the person or business.`); flags.close = true; }
    else if (c.result === "no_match") { add("bad", `✗ <b>Name doesn't match.</b> This account doesn't belong to "${esc(to.name)}". Scammers often use a real name with their own account. Check the details directly with the person or business.`); flags.mismatch = true; }
    else add("warn", "<b>We couldn't check the name on this account.</b> Only continue if you got these details directly from the person or business.");
    if (isBusiness && c.accountType === "personal") { add("bad", "<b>This is a personal account, not a business account.</b> Real businesses usually get paid into a business account. Check with the business before you pay."); flags.personal = true; }
  } else {
    add("ok", `This PayID is registered to <b>${esc(pid.name)}</b>. Make sure that's who you mean to pay.`);
    if (isBusiness && pid.type === "personal") { add("bad", "<b>This PayID belongs to a personal account, not a business.</b> Real businesses usually get paid into a business account."); flags.personal = true; }
  }
  if (i.reports) add(i.confirmed ? "bad" : "warn", "🚩 " + reportText(i.reports, i.confirmed, to.type === "payid" ? "PayID" : "account"));
  if (i.newAccount) add("warn", "<b>This account is very new</b>, or has suddenly started receiving payments from lots of new people. Scammers often use accounts like this.");
  return { found: true, key, name, sameBank: c ? c.sameBank : null, intel: i, items, flags };
}

/* ---------- Scam Risk Score ---------- */
function assess({ amt, desc, balance, known, flags, intel: i, invoice, plan }) {
  const reasons = []; let s = 0;
  const add = (n, why) => { s += n; if (why) reasons.push(why); };
  if (i.reports && i.confirmed) add(50, "This account has been reported as a scam, and our fraud team has confirmed it.");
  else if (i.reports) add(Math.min(35, 10 + 5 * i.reports), `${i.reports} ${plural(i.reports, "customer has", "customers have")} reported this account as a possible scam.`);
  if (flags.mismatch) add(30, "The name you entered doesn't match the account.");
  if (flags.personal) add(20, "You're paying a business, but this is a personal account.");
  if (i.newAccount) add(20, "The account is very new, or has suddenly started receiving payments from lots of people.");
  if (invoice) {
    if (invoice.detailsChanged) add(30, "The business's bank details have changed since you last paid them.");
    if (invoice.abnProblem) add(30, String(invoice.abnProblem));
    if (invoice.edited) add(25, "The invoice shows signs of being edited.");
    if (invoice.lookalike) add(25, "The invoice email came from an address that doesn't match the business.");
    if (invoice.changedWording) add(15, "The invoice says the bank details changed, or asks you to pay urgently.");
    if (invoice.newAbn) add(15, "The business's ABN was registered only recently.");
    if (invoice.verified) add(-15);
  }
  if (!known) add(15, "You haven't paid this account before.");
  const big = amt >= BIG && !(known && known.times >= 3);
  const planned = big && !!plan && amt <= plan.amt * PLAN_MARGIN;
  const forced = big && !planned;
  if (forced) add(20, `This is a big payment (${U.money(BIG)} or more) to someone you don't pay regularly, and it wasn't planned.`);
  if (planned) add(-15);
  if (amt > USUAL * 10) add(20, `${U.money(amt)} is much more than you usually send (around ${U.money(USUAL)}).`);
  else if (amt > USUAL * 4) add(10, `${U.money(amt)} is more than you usually send (around ${U.money(USUAL)}).`);
  if (amt > balance * 0.5) add(10, "This would use more than half of your balance.");
  const hits = scamWords.filter(w => String(desc || "").toLowerCase().includes(w));
  if (hits.length) add(15, `The description mentions "${hits.join('", "')}", which is common in scams.`);
  if (known && known.times >= 3) add(-20);
  if (flags.match) add(-10);
  return { score: Math.max(0, Math.min(100, s)), reasons, forced, overPlan: big && !!plan && !planned, planAmt: plan ? plan.amt : null };
}

function reviewPayment(b) {
  const to = b.to || {};
  const amt = parseAmt(b.amt), balance = Number(b.balance);
  if (to.type === "bsb") {
    if (!String(to.name || "").trim()) return { error: "Enter the account name." };
    if (digits(to.bsb).length !== 6) return { error: "BSB must be 6 digits." };
    const a = digits(to.acc).length; if (a < 6 || a > 9) return { error: "Account number must be 6 to 9 digits." };
  } else if (to.type === "payid") {
    if (!normId(to.payid)) return { error: "Enter a PayID." };
  } else return { error: "Choose BSB and account, or PayID." };
  if (!(amt > 0)) return { error: "Enter an amount." };
  if (isFinite(balance) && amt > balance) return { error: "Not enough money in this account." };
  const nc = nameCheck(to, !!b.isBusiness);
  if (!nc.found) return { error: "This PayID isn't registered, so payments can't be sent to it. Check it with the person or business you're paying." };
  // A saved payee's account with a name that doesn't match isn't treated as someone you know
  const known = b.known && !nc.flags.mismatch ? { times: Number(b.known.times) || 0 } : null;
  const risk = assess({ amt, desc: b.desc, balance, known, flags: nc.flags, intel: nc.intel, invoice: b.invoice || null, plan: b.plan && b.plan.amt > 0 ? { amt: Number(b.plan.amt) } : null });
  return { name: nc.name, key: nc.key, sameBank: nc.sameBank, items: nc.items, flags: nc.flags, intel: nc.intel, knownCounts: !!known, risk };
}

/* ---------- Answers to the 3 scam questions ---------- */
const answerReasons = [
  "Someone contacted you out of the blue and asked you to pay. This is how most scams start.",
  "You got the bank details from an email, text or call. Scammers send fake invoices and \"updated bank details\" this way.",
  "You're being rushed or asked to keep it secret. Real people and businesses don't do this."
];
function answersVerdict({ score, answers, reported }) {
  const a = Array.isArray(answers) ? answers.slice(0, QUESTIONS).map(v => (v ? 1 : 0)) : [];
  if (a.length < QUESTIONS) return { error: "Please answer all three questions." };
  const yes = a.reduce((x, y) => x + y, 0);
  const total = Math.min(100, (Number(score) || 0) + yes * 15);
  return { total, strong: yes > 0 || !!reported || total >= 70, level: total >= 70 ? "very high" : "high", reasons: a.map((v, i) => (v ? answerReasons[i] : null)).filter(Boolean) };
}

/* ---------- Message checker ---------- */
function checkMessage(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return { level: "none", findings: [] };
  const f = [];
  if (/https?:\/\/|www\.|\.co\b|\.com\b/.test(t)) f.push("Contains a link. Westpac never texts you a link to log in.");
  if (/suspend|locked|unusual activity|verify your/.test(t)) f.push("Says something is wrong with your account, to make you panic.");
  if (/(new|updated|changed|change of)\s+(our\s+)?(bank|account|payment)\s+details|bank\s+details\s+(have\s+)?changed|new account/.test(t)) f.push("Says their bank details have changed. Always confirm this by calling the business on a number you find yourself.");
  if (/urgent|within \d+ hours|today|immediately|right now/.test(t)) f.push("Pressures you to act fast.");
  if (/guaranteed|returns|crypto|bitcoin|investment/.test(t)) f.push("Promises guaranteed or unrealistic returns.");
  if (/transfer|\$\d|gift card|\bpay\b|payment|bsb/.test(t)) f.push("Asks you to send money.");
  if (/\bato\b|police|government|tax debt/.test(t)) f.push("Pretends to be from an authority.");
  return { level: f.length >= 2 ? "bad" : f.length === 1 ? "warn" : "ok", findings: f };
}

/* ---------- Big payment plan ---------- */
function startPlan({ type, amt, answers }) {
  const amount = parseAmt(amt);
  if (!(amount >= BIG)) return { ok: false, error: `Big payments are ${U.money(BIG)} or more.` };
  const a = Array.isArray(answers) ? answers.slice(0, QUESTIONS) : [];
  if (a.length < QUESTIONS || a.some(v => v !== 0 && v !== 1 && v !== true && v !== false)) return { ok: false, error: "Please answer all three questions." };
  if (a.some(v => v === 1 || v === true)) return { ok: false, refused: true };
  return { ok: true, plan: { start: Date.now(), type: String(type || "Other").slice(0, 40), amt: amount } };
}

/* ---------- Invoices ---------- */
// Reads an invoice or email pasted as text into the invoice-check field format
function parseInvoiceText(text) {
  const t = String(text || "").replace(/\r/g, "");
  const g = re => { const m = t.match(re); return m ? m[1].trim() : ""; };
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  const start = lines.findIndex(l => /^(tax )?invoice$/i.test(l));
  let business = start >= 0 ? (lines[start + 1] || "") : "";
  if (!business) { const ai = lines.findIndex(l => /\bABN\b/i.test(l)); business = ai > 0 ? lines[ai - 1] : ""; }
  const total = parseAmt(g(/(?:Total due|Amount due|Balance due|Total)[^\d\n]*\$?\s*([\d,]+\.\d{2})/i));
  return {
    business_name: business,
    abn: digits(g(/\bABN[:\s#]*((?:\d\s?){11})/i)),
    phone: g(/\bPh(?:one)?[:\s]*([\d()\s+]{8,16}\d)/i),
    invoice_number: g(/(?:Invoice number|Invoice No\.?|Invoice #)[:\s#]*([A-Z0-9-]+)/i),
    subtotal: parseAmt(g(/(?:Amount before GST|Subtotal|Sub-total)[^\d\n]*\$?\s*([\d,]+\.\d{2})/i)) || 0,
    gst: parseAmt(g(/^\s*GST\b[^\n$]*\$\s*([\d,]+\.\d{2})/im)) || 0,
    total: total || 0, amount_due: total || 0,
    account_name: g(/Account name[:\s]*([^\n]+)/i),
    bsb: digits(g(/\bBSB[:\s#]*(\d{3}[-\s]?\d{3})/i)),
    account_number: digits(g(/\bAcc(?:ount)?\.?\s*(?:No\.?|Number|#)[:\s#]*((?:\d[\s-]?){5,9}\d)/i)),
    reference: g(/Reference[:\s#]*([A-Z0-9-]+)/i),
    bank_change_notice: false, urgency_language: false, tamper_signs: []
  };
}
function parseEmail(text) {
  const froms = Array.from(String(text || "").matchAll(/^\s*From:\s*(.*)$/gim))
    .map(m => ((m[1].match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [""])[0]).toLowerCase()).filter(Boolean);
  return froms.length ? { from: froms[0], all: froms, text: String(text) } : null;
}

// The app's editable fields <-> the invoice-check fields
const money2 = v => U.num(v) > 0 ? U.num(v).toFixed(2) : "";
const toAppFields = x => ({
  business: x.business_name || "", abn: U.digits(x.abn).length === 11 ? U.fmtAbn(x.abn) : String(x.abn || ""),
  accountName: x.account_name || x.business_name || "", bsb: fmtBsb(x.bsb), account: digits(x.account_number),
  amount: money2(x.amount_due || x.total), reference: x.reference || x.invoice_number || "",
  invoiceNumber: x.invoice_number || "", date: x.invoice_date || "", subtotal: money2(x.subtotal), gst: money2(x.gst), total: money2(x.total),
  email: x.email || "", phone: x.phone || ""
});
const s = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const FIELD_LIMITS = { business: 140, abn: 60, accountName: 140, bsb: 10, account: 12, amount: 20, reference: 40, invoiceNumber: 40, date: 40, subtotal: 20, gst: 20, total: 20, email: 120, phone: 30 };

const GROUPS = [
  ["The business", ["Checking ABN", "Searching business register", "Checking GST registration"]],
  ["Bank account", ["Confirming account owner (KYC)", "Comparing with your payees", "Screening receiving account", "Checking scam reports"]],
  ["The invoice itself", ["Analysing the invoice", "Matching payment to invoice", "Checking transfer pattern", "AI risk review"]]
];
const DOT = { pass: "ok", info: "ok", warn: "warn", fail: "bad" };
const aiCache = new Map(); // invoice details -> AI risk review, so re-checking the same invoice doesn't call Gemini again

// Step 1: what was read from the invoice (Gemini fields, or the text of a pasted email), as the app's fields
// body: { text, doc: { ai: fields read by Gemini }, fields (the app's editable fields, null before they're filled in) }
function prepareInvoice(body) {
  const text = String(body.text || "").slice(0, 200000);
  const em = parseEmail(text);
  const read = body.doc && body.doc.ai && typeof body.doc.ai === "object" ? body.doc.ai : {};
  const base = { ...(text ? parseInvoiceText(text) : {}), ...Object.fromEntries(Object.entries(read).filter(([, v]) => v !== "" && v !== 0 && v != null)) };
  if (em) {
    base.email = em.from;
    if (/(new|updated|changed|change of|change in)\s+(our\s+)?(bank|banking|account|payment)\s+details|bank\s+details\s+(have\s+)?(changed|been\s+updated)/i.test(em.text)) base.bank_change_notice = true;
    if (/pay\b[^.\n]{0,40}\b(urgently|immediately|today)|\burgent/i.test(em.text)) base.urgency_language = true;
    const others = Array.from(new Set(em.all)).filter(x => x !== em.from);
    if (others.length) base.tamper_signs = [...(base.tamper_signs || []), `Earlier messages in this email chain came from a different address (${others[0]}), so the business's email may have been hacked or copied`];
  }
  const read0 = toAppFields(base), f = body.fields || read0;
  // Older saved scans only have the payment fields, so anything missing falls back to what was read
  const fields = Object.fromEntries(Object.entries(FIELD_LIMITS).map(([k, n]) => [k, s(f[k] != null ? f[k] : read0[k], n)]));
  return { base, em, fields };
}

// Step 2: Invoice Check on the (customer-checked) fields
async function analyzeInvoice(body) {
  const { base, em, fields } = prepareInvoice(body);
  const x = {
    ...base, business_name: fields.business, abn: digits(fields.abn), account_name: fields.accountName, bsb: digits(fields.bsb), account_number: digits(fields.account),
    amount_due: U.num(fields.amount), reference: fields.reference, invoice_number: fields.invoiceNumber || fields.reference, invoice_date: fields.date,
    subtotal: U.num(fields.subtotal), gst: U.num(fields.gst), total: U.num(fields.total) || U.num(fields.amount), email: fields.email, phone: fields.phone
  };

  const { checks, reg, acct } = await runChecks(x);
  // Bank details the customer paid before from this app (saved in their browser)
  const h = x.abn && body.history && body.history[x.abn];
  if (h && typeof h === "object" && x.bsb && !checks.some(c => c.title === "Bank details have changed")) {
    if (digits(h.bsb) + digits(h.acc) !== x.bsb + x.account_number)
      checks.push({ label: "Comparing with your payees", title: "Bank details have changed", status: "warn", detail: `These bank details are different from your last payment to this business (${s(h.last, 40)}). Call the business on a number you find yourself, not the one on the invoice.`, source: "Your payment history" });
  }
  let v = verdict(checks), summary = templateSummary(v.level, checks, x, reg, acct), summarySource = "template";
  if (gemini.enabled()) {
    const key = crypto.createHash("sha1").update(JSON.stringify(x)).digest("hex");
    try {
      if (!aiCache.has(key)) aiCache.set(key, await gemini.explain(v.level, checks, x));
      const ai = aiCache.get(key), reasons = ai.reasons.join("; "), src = `AI risk review (${gemini.model()})`;
      if (ai.risk === "high") checks.push({ label: "AI risk review", title: "AI flagged a high scam risk", status: "warn", detail: reasons || "The combination of signals matches a known scam pattern.", source: src });
      else if (ai.risk === "medium") checks.push({ label: "AI risk review", title: "AI noted some risk", status: "info", detail: reasons || "Some signals worth a second look.", source: src });
      else checks.push({ label: "AI risk review", title: "AI found no scam pattern", status: "pass", detail: reasons || "Nothing in the overall picture matches a known scam pattern.", source: src });
      v = verdict(checks);
      if (ai.summary && v.level !== "red") { summary = ai.summary; summarySource = "ai"; }
    } catch (e) { console.warn("AI review failed, using rules only:", e.message); }
  }
  if (body.first) logVerification(x, v, summary); // log the customer's "Check this invoice", not every re-check while typing

  // Grouped checklist in the app's format: [['head', title], ['ok' | 'warn' | 'bad', html], ...]
  const items = [];
  for (const [head, labels] of GROUPS) {
    const rows = checks.filter(c => labels.includes(c.label));
    if (!rows.length) continue;
    items.push(["head", head]);
    rows.forEach(c => items.push([DOT[c.status] || "warn", `<b>${esc(c.title)}.</b> ${esc(c.detail)} <span style="opacity:.6">(${esc(c.source)})</span>`]));
  }
  const nBad = checks.filter(c => c.status === "fail").length, nWarn = checks.filter(c => c.status === "warn").length;
  const level = { red: "bad", amber: "warn", green: "ok" }[v.level];
  const short = level === "bad" ? `${nBad} serious ${plural(nBad, "problem", "problems")} found. This could be a scam.` : level === "warn" ? `${nWarn} ${plural(nWarn, "thing", "things")} to double-check.` : "Everything checks out.";
  const verdictBox = {
    bad: { icon: "✗", title: "This could be a scam", text: `We found ${nBad} serious ${plural(nBad, "problem", "problems")}. We recommend you don't pay until you've called the business on a phone number you find yourself. It's still your decision.` },
    warn: { icon: "!", title: "A few things to double-check", text: summary },
    ok: { icon: "✓", title: "Everything checks out", text: summary }
  }[level];

  const has = t => checks.some(c => c.title === t);
  const integrity = checks.find(c => c.label === "Analysing the invoice");
  const flags = {
    abnProblem: has("ABN is not a valid number") ? "The ABN on the invoice isn't a valid number." : has("ABN is cancelled") ? "The ABN on the invoice has been cancelled."
      : has("Business name doesn't match the ABN") ? "The business name on the invoice doesn't match its ABN." : has("No registered business") || has("Business not found") ? "The ABN on the invoice isn't registered." : null,
    detailsChanged: has("Bank details have changed"),
    lookalike: !!(integrity && integrity.status !== "pass" && /look-alike|free email|isn't the business's registered domain|different address/i.test(integrity.detail)),
    changedWording: !!(x.bank_change_notice || x.urgency_language),
    edited: !!(x.tamper_signs && x.tamper_signs.length),
    newAbn: has("Business is registered, but very new"),
    verified: v.level === "green"
  };
  return {
    fields, email: em ? { from: em.from } : null, items, level, summary: short, verdict: verdictBox, score: v.score,
    // The Invoice Check list the app animates one by one, and the summary shown in its AI bubble
    checks: checks.map(c => ({ label: c.label, title: c.title, status: c.status, detail: c.detail, source: c.source })),
    bubble: level === "bad" ? verdictBox.text : summary, summarySource,
    check: { ...flags, abn: x.abn, business: reg ? (reg.trading_names || "").split(",")[0] || reg.entity_name : fields.business, level, summary: short, key: x.bsb + x.account_number }
  };
}

/* ---------- Routes ---------- */
module.exports = function appApi({ demoByHash }) {
  const r = express.Router();
  const json = express.json({ limit: "1mb" });
  const wrap = fn => async (req, res) => {
    try {
      const out = await fn(req.body || {}, req);
      if (out && out.status && (out.error || out.message)) return res.status(out.status).json({ ok: false, error: out.error || out.message });
      res.json(out);
    } catch (e) { console.error(e); res.status(500).json({ error: "Something went wrong on the server." }); }
  };

  r.get("/health", (req, res) => res.json({ ok: true, ai: gemini.enabled(), abrLive: abr.enabled() }));
  r.get("/customer/me", (req, res) => res.json(CUSTOMER));
  r.get("/bpay/:code", (req, res) => {
    const b = db.get("SELECT * FROM bpay_billers WHERE code = ?", [digits(req.params.code).slice(0, 10)]);
    res.json(b ? { found: true, name: b.name } : { found: false });
  });
  r.post("/payment/namecheck", json, wrap(b => {
    const x = nameCheck(b.to || {}, !!b.isBusiness);
    return x.found ? { found: true, name: x.name, sameBank: x.sameBank, items: x.items, flags: x.flags } : { found: false };
  }));
  r.post("/payment/review", json, wrap(b => reviewPayment(b)));
  r.post("/payment/answers", json, wrap(b => answersVerdict(b)));
  r.post("/message/check", json, wrap(b => checkMessage(b.text)));
  r.post("/plan/start", json, wrap(b => startPlan(b)));

  // Read an invoice file (sent as base64) with Gemini, or use the saved details for a demo invoice
  r.post("/invoice/read", express.json({ limit: "25mb" }), wrap(async b => {
    const buf = Buffer.from(String(b.data || ""), "base64");
    if (!buf.length) return { status: 400, error: "No file received." };
    const isPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
    const mime = isPdf ? "application/pdf" : /^image\//.test(b.type) ? b.type : "image/png";
    const kind = isPdf ? "PDF" : "IMG";
    const stored = demoByHash[crypto.createHash("sha1").update(buf).digest("hex")] || null;
    console.log(`Invoice received: ${s(b.name, 80) || "file"} (${(buf.length / 1e6).toFixed(2)} MB)`);
    if (gemini.enabled()) {
      try { return { kind, text: "", doc: { ai: await gemini.extractInvoice(buf, mime), source: "ai", model: gemini.model() } }; }
      catch (e) { console.error("AI extraction failed:", e.message); if (!stored) return { status: 422, error: "AI couldn't read this invoice. Please type the details." }; }
    }
    if (stored) return { kind, text: "", doc: { ai: stored, source: "demo" } };
    return { status: 422, error: "AI isn't switched on (no Gemini key), so please type the invoice details." };
  }));
  r.post("/invoice/prepare", express.json({ limit: "5mb" }), wrap(b => { const { fields, em } = prepareInvoice(b); return { fields, email: em ? { from: em.from } : null }; }));
  r.post("/invoice/analyze", express.json({ limit: "5mb" }), wrap(b => analyzeInvoice(b)));

  // Report an account or PayID as a scam (identity-verified customer, once per account, 10 an hour)
  r.post("/intel/report", json, wrap(b => {
    const k = normId(b.key);
    if (!/^\d{12,15}$/.test(k) && !/^[a-z0-9@._+-]{6,254}$/.test(k)) return { ok: false, status: 400, message: "That doesn't look like an account or PayID." };
    if (CUSTOMER.kyc.status !== "verified") return { ok: false, status: 403, message: "Only customers who have verified their identity can report scams." };
    if (db.get("SELECT 1 FROM customer_reports WHERE key = ? AND customer_id = ?", [k, CUSTOMER.id])) return { ok: false, already: true, message: "You've already reported this account. Thank you." };
    if (db.get("SELECT COUNT(*) AS n FROM customer_reports WHERE customer_id = ? AND reported_at >= ?", [CUSTOMER.id, new Date(Date.now() - 3600000).toISOString()]).n >= REPORTS_PER_HOUR)
      return { ok: false, status: 429, message: "You've made a lot of reports in the last hour. Please try again later or call us." };
    const now = new Date().toISOString(), note = s(b.name, 200);
    db.run("INSERT INTO customer_reports (key,customer_id,reported_at,note) VALUES (?,?,?,?)", [k, CUSTOMER.id, now, note]);
    const isAcct = /^\d+$/.test(k);
    db.run(`INSERT INTO fraud_cases (created_at,kind,payee,bsb,account_number,status,findings) VALUES (?,?,?,?,?,?,?)`,
      [now, "Customer report (app)", note, isAcct ? k.slice(0, 6) : "", isAcct ? k.slice(6) : k, "Open", `${CUSTOMER.firstName} ${CUSTOMER.lastName} reported this ${isAcct ? "account" : "PayID"} as a scam from the app.`]);
    db.save();
    return { ok: true };
  }));
  return r;
};
