// The verification engine: 9 checks against the bank database -> green / amber / red + trust score.
const U = require("./util");
const abr = require("./abr");
const db = require("./db");

const FREE_MAIL = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "bigpond.com", "live.com"];
const CUSTOMER = { name: "Coomera Coffee Roasters Pty Ltd (ABN 45 627 048 281)", account: "Business One 034-111 6620 1984" };
const fmtBsb = b => { const d = U.digits(b); return d.length === 6 ? d.slice(0, 3) + "-" + d.slice(3) : b; };
const fmtAcc = a => { const d = U.digits(a); return d.length === 8 ? d.slice(0, 4) + " " + d.slice(4) : d; };
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";
const daysSince = iso => iso ? Math.round((Date.now() - new Date(iso).getTime()) / db.DAY) : null;

async function runChecks(x) {
  const abn = U.digits(x.abn);
  const bsb = U.digits(x.bsb), acc = U.digits(x.account_number);
  const reg = U.abnValid(abn) ? await abr.lookup(abn) : null;
  const acct = db.get("SELECT * FROM bank_accounts WHERE bsb = ? AND account_number = ?", [bsb, acc]);
  const expectedName = reg?.entity_name || x.business_name;
  const names = reg ? [reg.entity_name, ...(reg.trading_names || "").split(",")].map(s => s.trim()).filter(Boolean) : [x.business_name];
  const nameMatch = n => Math.max(...names.map(m => U.similar(n, m)));
  const regSrc = reg?.source === "live" ? "Australian Business Register (live) + bank database" : "Business register (bank database)";
  const C = [];
  const add = (label, title, status, detail, source, crit = false) => C.push({ label, title, status, detail, source, crit });

  // 1. ABN checksum
  if (U.abnValid(abn)) add("Checking ABN", "ABN is a valid number", "pass", `ABN ${U.fmtAbn(abn)} passes the official ATO checksum.`, "Real-time calculation");
  else add("Checking ABN", "ABN is not a valid number", "fail", `ABN ${x.abn || "(missing)"} fails the ATO checksum, so no business can have been issued this number.`, "Real-time calculation", true);

  // 2. Business register: exists, active, name, age
  if (reg) {
    const age = daysSince(reg.abn_registered);
    if (reg.abn_status !== "Active")
      add("Searching business register", "ABN is cancelled", "fail", `This ABN belonged to ${reg.entity_name} but is now "${reg.abn_status}". A cancelled business can't issue valid invoices.`, regSrc, true);
    else if (nameMatch(x.business_name) < 0.8)
      add("Searching business register", "Business name doesn't match the ABN", "fail", `This ABN is registered to "${reg.entity_name}"${reg.trading_names ? ` (trading as ${reg.trading_names})` : ""}, but the invoice says "${x.business_name}".`, regSrc, true);
    else if (age != null && age < 180)
      add("Searching business register", "Business is registered, but very new", "warn", `${reg.entity_name}${reg.trading_names ? ` (${reg.trading_names})` : ""} · ${reg.entity_type} · ABN registered only ${U.ageText(age)} ago.`, regSrc);
    else
      add("Searching business register", "Business is registered and active", "pass", `${reg.entity_name} · ${reg.entity_type || "Business"} · Active since ${fmtDate(reg.abn_registered)} · ${reg.industry || ""}${reg.state ? " · " + reg.state : ""}.`, regSrc);
  } else if (U.abnValid(abn)) add("Searching business register", "Business not found", "warn", "The ABN is valid but isn't in the business register database. Treat with caution.", regSrc);
  else add("Searching business register", "No registered business", "fail", "No business is registered under this ABN.", regSrc, true);

  // 3. GST registration
  if (x.gst > 0) {
    if (reg && !reg.gst_registered)
      add("Checking GST registration", "Charging GST without being registered", "fail", `The invoice charges ${U.money(x.gst)} GST, but ${reg.trading_names || reg.entity_name} isn't registered for GST. That's illegal and a common sign of a fake invoice.`, "Business register (GST)", true);
    else if (reg) add("Checking GST registration", "GST registration confirmed", "pass", `Registered for GST since ${fmtDate(reg.gst_registered)}.`, "Business register (GST)");
    else add("Checking GST registration", "GST registration unknown", "warn", "Couldn't confirm the business is registered to charge GST.", "Business register (GST)");
  } else add("Checking GST registration", "No GST charged", "info", reg && !reg.gst_registered ? "Business isn't GST-registered, and the invoice correctly charges no GST." : "The invoice doesn't charge GST.", "Business register (GST)");

  // 4. Account owner: Confirmation of Payee + KYC link to the ABN
  if (!acct) add("Confirming account owner (KYC)", "Account owner couldn't be confirmed", "warn", `BSB ${fmtBsb(bsb)} / ${fmtAcc(acc)} isn't in the bank network database, so we can't confirm who owns it.`, "Confirmation of Payee + KYC records");
  else if (acct.linked_abn && acct.linked_abn === abn && acct.kyc_status === "Verified")
    add("Confirming account owner (KYC)", "KYC-verified account of this business", "pass", `${acct.bank_name} ${acct.account_type.toLowerCase()} account "${acct.account_name}", linked to ABN ${U.fmtAbn(abn)}, KYC verified ${fmtDate(acct.kyc_verified_on)}.`, "Confirmation of Payee + KYC records");
  else if (acct.linked_abn && acct.linked_abn !== abn)
    add("Confirming account owner (KYC)", "Account belongs to a different business", "fail", `This account is registered to ABN ${U.fmtAbn(acct.linked_abn)} ("${acct.account_name}"), not ${expectedName}.`, "Confirmation of Payee + KYC records", true);
  else if (nameMatch(acct.account_name) >= 0.8 && acct.kyc_status !== "Pending")
    add("Confirming account owner (KYC)", "Account name matches the business", "pass", `${acct.bank_name} confirms the account is held by ${acct.account_name}.`, "Confirmation of Payee + KYC records");
  else
    add("Confirming account owner (KYC)", "Account does NOT belong to this business", "fail", `${acct.bank_name} says this is a ${acct.account_type.toLowerCase()} account held by "${acct.account_name}" (KYC: ${acct.kyc_status}), not ${expectedName}.`, "Confirmation of Payee + KYC records", true);

  // 5. History: saved payee + previous transfers
  const saved = abn ? db.get("SELECT * FROM saved_payees WHERE abn = ?", [abn]) : null;
  const hist = abn ? db.all("SELECT * FROM transfers WHERE abn = ? AND status = 'Sent' ORDER BY created_at DESC", [abn]) : [];
  const knownAcct = (saved && saved.bsb === bsb && saved.account_number === acc) || hist.some(h => h.bsb === bsb && h.account_number === acc);
  if (!saved && !hist.length) add("Comparing with your payees", "New business for you", "info", "You haven't paid this business before, so there are no saved bank details to compare.", "Your saved payees + payment history");
  else if (knownAcct) {
    const last = hist.find(h => h.bsb === bsb && h.account_number === acc);
    add("Comparing with your payees", "Same bank details as before", "pass", saved ? `Matches your saved payee "${saved.nickname}"${last ? `, last paid ${fmtDate(last.created_at)} (${U.money(last.amount)})` : ""}.` : `Matches your payment on ${fmtDate(last.created_at)}.`, "Your saved payees + payment history");
  } else {
    const ref = saved ? `your saved payee "${saved.nickname}" (BSB ${fmtBsb(saved.bsb)}, acc ${fmtAcc(saved.account_number)})` : `your last payment (BSB ${fmtBsb(hist[0].bsb)}, acc ${fmtAcc(hist[0].account_number)})`;
    add("Comparing with your payees", "Bank details have changed", "warn", `These bank details don't match ${ref}. Changed bank details are the #1 sign of an invoice redirection scam.`, "Your saved payees + payment history");
  }

  // 6. Money-mule screening
  if (acct) {
    let pts = 0; const why = [];
    const days = daysSince(acct.opened_on);
    if (days < 30) { pts += 35; why.push(`opened ${U.ageText(days)} ago`); } else if (days < 60) pts += 10;
    if (acct.unique_senders_7d >= 10 && acct.account_type === "Personal") { pts += 30; why.push(`${acct.unique_senders_7d} deposits from unrelated people in 7 days`); }
    else if (acct.unique_senders_7d >= 5 && days < 30) { pts += 10; why.push(`${acct.unique_senders_7d} deposits from unrelated people in 7 days`); }
    if (acct.outflow_24h_pct >= 70) { pts += 30; why.push(`${acct.outflow_24h_pct}% of incoming money moved out within 24 hours`); }
    if (acct.kyc_status === "Pending") { pts += 15; why.push("identity checks not completed"); }
    const src = "Bank risk model";
    if (pts >= 60) add("Screening receiving account", "Receiving account looks like a money mule", "fail", `High risk: ${why.join("; ")}.`, src, true);
    else if (pts >= 25) add("Screening receiving account", "Receiving account has some risk signals", "warn", `Medium risk: ${why.join("; ")}.`, src);
    else add("Screening receiving account", "Receiving account behaves normally", "pass", `${acct.account_type} account, open ${U.ageText(days)}, normal transaction patterns.`, src);
  } else add("Screening receiving account", "Receiving account not screened", "warn", "No transaction data for this account.", "Bank risk model");

  // 7. Scam intelligence (confirmed reports)
  const dom = (x.email || "").split("@")[1]?.toLowerCase() || "";
  const phone = U.digits(x.phone);
  const hits = db.all(`SELECT * FROM scam_reports WHERE (type='account' AND value=?) OR (type='abn' AND value=?) OR (type='email_domain' AND value=?) OR (type='phone' AND value=?)`,
    [bsb + acc, abn || "-", dom || "-", phone || "-"]);
  if (hits.length) add("Checking scam reports", `Matches ${hits.length} confirmed scam report${hits.length > 1 ? "s" : ""}`, "fail",
    hits.map(h => `${h.type === "email_domain" ? "Email domain" : h.type === "account" ? "Bank account" : h.type === "phone" ? "Phone number" : "ABN"}: ${h.description} (${h.source}, ${fmtDate(h.reported_on)})`).join(". ") + ".",
    "Fraud team, AFCX and Scamwatch reports", true);
  else add("Checking scam reports", "No scam reports", "pass", "The account, ABN, email domain and phone number have no confirmed scam reports.", "Fraud team, AFCX and Scamwatch reports");

  // 8. Invoice integrity
  const issues = [], warns = [];
  if (x.subtotal && x.gst && Math.abs(x.gst - x.subtotal * 0.1) > 0.05) issues.push(`GST of ${U.money(x.gst)} isn't 10% of ${U.money(x.subtotal)} (should be ${U.money(x.subtotal * 0.1)})`);
  if (x.subtotal && x.total && Math.abs(x.subtotal + x.gst - x.total) > 0.05) issues.push("subtotal plus GST doesn't add up to the total");
  if (dom && reg?.email_domain && dom !== reg.email_domain) {
    if (U.lev(dom, reg.email_domain) <= 4 || dom.includes(reg.email_domain.split(".")[0])) issues.push(`email domain "${dom}" is a look-alike of the business's real domain "${reg.email_domain}"`);
    else if (FREE_MAIL.includes(dom)) warns.push(`business uses a free email address (${dom}) instead of ${reg.email_domain}`);
    else warns.push(`email domain "${dom}" isn't the business's registered domain "${reg.email_domain}"`);
  } else if (dom && FREE_MAIL.includes(dom)) warns.push(`business uses a free email address (${dom})`);
  if (phone && reg?.phone && phone !== U.digits(reg.phone)) warns.push(`phone number on the invoice (${x.phone}) differs from the registered number ${reg.phone}`);
  if (String(x.bank_change_notice) === "true") warns.push("invoice says the bank details have changed");
  if (String(x.urgency_language) === "true") warns.push("invoice pressures you to pay urgently");
  (x.tamper_signs || []).forEach(t => warns.push(U.lowerFirst(String(t))));
  if (issues.length) add("Analysing the invoice", "Invoice shows signs of fraud", "fail", U.cap([...issues, ...warns].join("; ")) + ".", "AI document analysis", true);
  else if (warns.length) add("Analysing the invoice", "Invoice has warning signs", "warn", U.cap(warns.join("; ")) + ".", "AI document analysis");
  else add("Analysing the invoice", "Invoice looks consistent", "pass", "Totals and GST add up, contact details match the business, and there are no signs of editing.", "AI document analysis");

  // 9. Payment matches invoice
  const due = x.amount_due || x.total;
  const refOk = !x.invoice_number || U.norm(x.reference).includes(U.norm(x.invoice_number));
  if (due > 0 && refOk) add("Matching payment to invoice", "Payment matches the invoice", "pass", `Paying ${U.money(due)} with reference ${x.reference || x.invoice_number}.`, "Payment details");
  else add("Matching payment to invoice", "Payment doesn't match the invoice", "warn", `Check the amount and reference match invoice ${x.invoice_number || ""}.`, "Payment details");

  // 10. Transfer pattern (velocity)
  const vel = velocity(x);
  if (vel.alerts.length) add("Checking transfer pattern", vel.alerts.length > 1 ? "Unusual transfer activity" : vel.alerts[0].title, "warn", vel.alerts.map(a => a.text).join(" "), "Your recent transfers");
  else add("Checking transfer pattern", "Normal transfer activity", "pass", "No unusual run of payments from your account in the last 24 hours.", "Your recent transfers");

  return { checks: C, reg, acct, vel };
}

/* ---------- Large-payment threshold + velocity (runs for every payment, even small ones) ---------- */
const threshold = () => Number(process.env.LARGE_PAYMENT_THRESHOLD) || 5000;
function velocity(x) {
  const amount = Number(x.amount_due || x.total || 0);
  const abn = U.digits(x.abn), bsb = U.digits(x.bsb), acc = U.digits(x.account_number);
  const since = h => new Date(Date.now() - h * 3600000).toISOString();
  const day = db.all("SELECT * FROM transfers WHERE status = 'Sent' AND created_at >= ?", [since(24)]);
  const same = day.filter(t => (t.bsb === bsb && t.account_number === acc) || (abn && t.abn === abn));
  const hour = day.filter(t => t.created_at >= since(1));
  const alerts = [];
  const sameTotal = same.reduce((s, t) => s + t.amount, 0) + amount;
  if (same.length >= 2 && sameTotal >= threshold())
    alerts.push({ type: "split", title: "Looks like a large payment split up", text: `This would be payment number ${same.length + 1} to ${same[0].payee} in 24 hours (${U.money(sameTotal)} in total). Splitting a large amount into smaller payments is a common scam and money-laundering pattern.` });
  if (hour.length >= 5)
    alerts.push({ type: "rapid", title: "Many transfers in a short time", text: `${hour.length + 1} transfers from your account in the last hour. Scammers often push victims to send several payments quickly.` });
  const dayTotal = day.reduce((s, t) => s + t.amount, 0) + amount;
  if (day.length >= 6 && dayTotal >= threshold() * 10)
    alerts.push({ type: "volume", title: "Unusually high outgoing payments today", text: `${U.money(dayTotal)} sent today across ${day.length + 1} payments, well above your normal daily activity.` });
  return { alerts, flagged: alerts.length > 0, amount, isLarge: amount >= threshold(), threshold: threshold() };
}

function verdict(C) {
  const crit = C.filter(c => c.status === "fail" && c.crit).length;
  const warn = C.filter(c => c.status === "warn").length;
  const score = Math.max(3, 100 - C.filter(c => c.status === "fail").length * 30 - warn * 10);
  return { level: crit ? "red" : warn ? "amber" : "green", score };
}

function templateSummary(level, C, x, reg, acct) {
  const name = reg?.trading_names?.split(",")[0] || reg?.entity_name || x.business_name || "the business";
  if (level === "green") return `This invoice checks out. ${name} is registered and active, and the bank account is a KYC-verified account belonging to them. You're good to pay.`;
  if (level === "amber") {
    const w = C.filter(c => c.status === "warn").map(c => U.lowerFirst(c.title)).join(", ");
    return `Some details need confirming (${w}). Call ${name} on ${reg?.phone || "a number you find yourself"} (from the business register, not the invoice) before you pay.`;
  }
  const fails = C.filter(c => c.status === "fail").map(c => U.lowerFirst(c.title));
  const who = acct && acct.linked_abn !== U.digits(x.abn) ? `the money would go to an account held by ${acct.account_name}, not ${name}` : "this invoice failed critical checks";
  return `Don't pay this invoice: ${who}. We found ${fails.length} serious problem${fails.length > 1 ? "s" : ""} (${fails.join(", ")}), so we've stopped the payment.`;
}

function caseSummary(v, C, x) {
  const id = Math.floor(Math.random() * 900000 + 100000);
  const findings = C.filter(c => c.status === "fail" || c.status === "warn").map(c => `- ${c.title}: ${c.detail}`).join("\n");
  return `CASE ${id} · Invoice Check · Trust score ${v.score}/100
Customer: ${CUSTOMER.name} (${CUSTOMER.account})
Attempted payment: ${U.money(x.amount_due || x.total)} to BSB ${fmtBsb(x.bsb)} / ${fmtAcc(x.account_number)} ("${x.account_name}")
Invoice: ${x.invoice_number} from "${x.business_name}" (ABN ${U.fmtAbn(x.abn)})
Findings:
${findings}
Recommended action: hold payment, contact customer via SafeCall, review receiving account for mule activity.`;
}

function logVerification(x, v, summary) {
  db.run(`INSERT INTO verifications (checked_at,business_name,abn,bsb,account_number,amount,level,score,summary) VALUES (?,?,?,?,?,?,?,?,?)`,
    [new Date().toISOString(), x.business_name || "", U.digits(x.abn), U.digits(x.bsb), U.digits(x.account_number), x.amount_due || x.total || 0, v.level, v.score, summary]);
  db.save();
}

module.exports = { runChecks, verdict, templateSummary, caseSummary, logVerification, velocity, threshold, fmtBsb, fmtAcc };
