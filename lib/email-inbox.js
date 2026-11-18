// Forward an invoice email -> it's checked automatically -> you get the result by email and in the app.
//
// Uses a Gmail inbox made for the app (set EMAIL_USER and EMAIL_APP_PASSWORD; the app password is made at
// https://myaccount.google.com/apppasswords and needs 2-Step Verification). Every EMAIL_POLL_SECONDS the app reads new
// emails over IMAP, checks the attached invoice (PDF or image) or the email text, saves the result (email_checks table)
// and replies to the sender over SMTP.
// Email services that POST incoming mail as JSON (for example CloudMailin) can use POST /api/email/inbound instead.
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");
const db = require("./db");
const U = require("./util");
const limits = require("./limits");

const USER = () => (process.env.EMAIL_USER || "").trim();
const PASS = () => (process.env.EMAIL_APP_PASSWORD || "").replace(/\s/g, "");
const enabled = () => !!(USER() && PASS());
const APP_URL = () => (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
let deps = null; // { read(buf, type, name), analyze(body) } from app-api
const state = { lastPoll: null, lastError: null, processed: 0, replies: 0, replyError: null };

function ensure() {
  db.run(`CREATE TABLE IF NOT EXISTS email_checks (  -- invoices forwarded by email, and their Invoice Check result
    id INTEGER PRIMARY KEY AUTOINCREMENT, received_at TEXT, sender TEXT, subject TEXT, business TEXT, amount REAL,
    level TEXT, score INTEGER, summary TEXT, checks TEXT, body TEXT, doc TEXT, reply TEXT)`);
}
function init(d) { deps = d; }

const LEVEL = { ok: ["🟢", "Everything checks out"], warn: ["🟡", "Check before you pay"], bad: ["🔴", "This could be a scam"] };
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// mail: { from, subject, text, attachments: [{ filename, contentType, content: Buffer }] }
async function processEmail(mail) {
  if (!deps) throw new Error("Email inbox isn't ready");
  const sender = String(mail.from || "").toLowerCase().slice(0, 200), subject = String(mail.subject || "(no subject)").slice(0, 200);
  const text = String(mail.text || "").slice(0, 20000);
  const save = r => {
    db.run(`INSERT INTO email_checks (received_at,sender,subject,business,amount,level,score,summary,checks,body,doc,reply) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [new Date().toISOString(), sender, subject, r.business || "", r.amount || 0, r.level || "", r.score ?? null, r.summary || "", JSON.stringify(r.checks || []), text, JSON.stringify(r.doc || null), ""]);
    db.save();
    return db.get("SELECT MAX(id) AS id FROM email_checks").id;
  };
  if (!limits.allow("email", sender || "?")) {
    console.warn(`Email from ${sender} skipped: over the daily limit`);
    return { id: null, skipped: true };
  }
  const file = (mail.attachments || []).find(a => /pdf|image\//i.test(a.contentType || "") || /\.(pdf|png|jpe?g|webp)$/i.test(a.filename || ""));
  let doc = null, note = "";
  if (file) {
    const r = await deps.read(file.content, file.contentType || "", file.filename || "attachment");
    if (r.doc) doc = { ...r.doc, kind: r.kind, file: String(file.filename || "").slice(0, 120) };
    else note = r.error || "We couldn't read the attached invoice.";
  }
  if (!doc && !/\bBSB\b|\bABN\b|invoice/i.test(text)) {
    const id = save({ level: "", summary: note || "We couldn't find an invoice in this email. Attach the invoice (PDF or photo) or forward the original email." });
    return { id, level: null, summary: note || "No invoice found" };
  }
  const res = await deps.analyze({ text, doc, first: true });
  const business = res.check.business || res.fields.business;
  const id = save({ business, amount: U.num(res.fields.amount), level: res.level, score: res.score, summary: res.bubble, checks: res.checks, doc });
  state.processed++;
  return { id, level: res.level, score: res.score, business, amount: U.num(res.fields.amount), summary: res.bubble, checks: res.checks };
}

function replyText(r, subject) {
  const [dot, title] = LEVEL[r.level] || ["⚪", "Not checked"];
  const lines = (r.checks || []).filter(c => c.status === "fail" || c.status === "warn").map(c => `${c.status === "fail" ? "✕" : "!"} ${c.title}: ${c.detail}`);
  const link = APP_URL() ? `\n\nSee every check in the app: ${APP_URL()}/#emails` : "";
  return {
    subject: `${dot} ${title}: ${r.business || "invoice"}${r.amount ? " " + U.money(r.amount) : ""} (re: ${subject})`.slice(0, 200),
    text: `Invoice Check result for "${subject}"\n\n${dot} ${title}${r.score != null ? ` · Trust score ${r.score}/100` : ""}\n${r.business || ""}${r.amount ? " · " + U.money(r.amount) : ""}\n\n${r.summary || ""}${lines.length ? "\n\nWhat we found:\n" + lines.join("\n") : ""}${link}\n\nNever pay using a phone number or bank details from the invoice itself. If in doubt, call the business on a number you find yourself.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px"><p style="color:#666">Invoice Check result for "${esc(subject)}"</p>
      <h2 style="margin:0">${dot} ${esc(title)}</h2><p style="color:#444">${esc(r.business || "")}${r.amount ? " · " + esc(U.money(r.amount)) : ""}${r.score != null ? ` · Trust score <b>${r.score}/100</b>` : ""}</p>
      <p>${esc(r.summary || "")}</p>${lines.length ? `<p><b>What we found</b></p><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${APP_URL() ? `<p><a href="${APP_URL()}/#emails">See every check in the app</a></p>` : ""}
      <p style="color:#888;font-size:12px">Never pay using a phone number or bank details from the invoice itself. If in doubt, call the business on a number you find yourself.</p></div>`
  };
}

// Replies go through Brevo's email API (HTTPS) when BREVO_API_KEY is set: free hosts like Render block the SMTP ports
// that Gmail sending needs. Otherwise they're sent with Gmail SMTP (works when running on your own computer).
async function reply(to, r, subject, messageId) {
  const m = replyText(r, subject);
  if (process.env.BREVO_API_KEY) {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "api-key": process.env.BREVO_API_KEY.trim(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Invoice Check", email: USER() }, to: [{ email: to }], subject: m.subject, textContent: m.text, htmlContent: m.html,
        headers: messageId ? { "In-Reply-To": messageId, References: messageId } : undefined })
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 150)}`);
    state.replies++; state.replyError = null;
    return;
  }
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: USER(), pass: PASS() }, connectionTimeout: 15000 });
  await t.sendMail({ from: `Invoice Check <${USER()}>`, to, subject: m.subject, text: m.text, html: m.html, inReplyTo: messageId, references: messageId });
  state.replies++; state.replyError = null;
}

// One pass over the inbox: every unread email is checked, answered and marked as read
let busy = false;
async function poll() {
  if (!enabled() || busy || !deps) return;
  busy = true;
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: USER(), pass: PASS() }, logger: false });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of (uids || []).slice(0, 10)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        const mail = await simpleParser(msg.source);
        const from = (mail.from && mail.from.value && mail.from.value[0] && mail.from.value[0].address || "").toLowerCase();
        // Don't answer ourselves, automatic replies or mailing lists
        if (!from || from === USER().toLowerCase() || mail.headers.get("auto-submitted") || mail.headers.get("list-id") || /mailer-daemon|no-?reply/i.test(from)) continue;
        try {
          const r = await processEmail({ from, subject: mail.subject, text: mail.text || "", attachments: (mail.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content })) });
          console.log(`Email from ${from} checked: ${r.level || "no invoice"}`);
          if (!r.skipped) {
            try { await reply(from, r, mail.subject || "your invoice", mail.messageId); if (r.id) db.run("UPDATE email_checks SET reply = ? WHERE id = ?", ["sent", r.id]); }
            catch (e) { state.replyError = e.message; console.warn("Reply email failed:", e.message); if (r.id) db.run("UPDATE email_checks SET reply = ? WHERE id = ?", ["failed: " + e.message.slice(0, 100), r.id]); }
            db.save();
          }
        } catch (e) { console.error("Email check failed:", e.message); }
      }
    } finally { lock.release(); }
    await client.logout();
    state.lastPoll = new Date().toISOString(); state.lastError = null;
  } catch (e) {
    state.lastError = e.message; console.warn("Email inbox:", e.message);
    try { await client.close(); } catch { /* already closed */ }
  } finally { busy = false; }
}

let timer = null;
function start() {
  if (!enabled() || timer) return;
  const every = Math.max(20, Number(process.env.EMAIL_POLL_SECONDS) || 60);
  console.log(`  Email inbox: forward invoices to ${USER()} (checked every ${every}s)`);
  poll(); timer = setInterval(poll, every * 1000);
}

const list = () => db.all("SELECT id, received_at, sender, subject, business, amount, level, score, summary, reply FROM email_checks ORDER BY id DESC LIMIT 20");
const one = id => { const r = db.get("SELECT * FROM email_checks WHERE id = ?", [Number(id)]); if (!r) return null; r.checks = JSON.parse(r.checks || "[]"); r.doc = JSON.parse(r.doc || "null"); return r; };
const status = () => ({ enabled: enabled(), address: USER() || null, ...state });

module.exports = { ensure, init, start, poll, processEmail, list, one, status };
