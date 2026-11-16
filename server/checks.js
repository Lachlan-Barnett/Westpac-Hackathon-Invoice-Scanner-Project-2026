'use strict';
/*
 * Scam Protect checks. Everything here runs on the server; the app only shows the results.
 *  - nameCheck        name on the account, PayID lookup, scam reports, new accounts
 *  - reviewPayment    all of the above plus the Scam Risk Score (points match Info.md)
 *  - answersVerdict   what the customer's answers to the 3 scam questions mean
 *  - analyzeInvoice   reads invoice text and runs every invoice check
 *  - checkMessage     scam signs in a pasted text or email
 *  - startPlan        rules for a big payment plan
 */
const S = require('./services');

const BIG = 2000;        // "big payment" threshold
const USUAL = 480;       // the demo customer's typical payment
const PLAN_MARGIN = 1.1; // a plan covers up to 10% more than the planned amount
const QUESTIONS = 3;
const scamWords = ['new account', 'new bank', 'updated details', 'urgent', 'overdue', 'final notice', 'ato', 'tax debt', 'crypto', 'bitcoin', 'gift card', 'safe account', 'refund', 'investment'];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n, one, many) => n === 1 ? one : many;
const digits = S.digits;
const fmtBsb = b => { const d = digits(b).slice(0, 6); return d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d; };
const fmtAbn = a => { const d = digits(a); return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : String(a || ''); };
const parseAmt = s => { const n = parseFloat(String(s || '').replace(/[$,\s]/g, '')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const monthsSince = date => { const d = new Date(date), n = new Date(); return (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth()); };
const fmtMonthYear = date => new Date(date).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
const fmtWhen = d => new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const sameBusiness = (name, a) => !!a && [a.name, a.entityName].concat(a.businessNames || []).some(n => S.normName(n) === S.normName(name));

function reportText(n, confirmed, what) {
  if (confirmed) return `<b>${n} ${plural(n, 'customer has', 'customers have')} reported this ${what} as a scam</b>, and our fraud team has confirmed it. We strongly recommend you don't pay it.`;
  return `<b>${n} ${plural(n, 'customer has', 'customers have')} reported this ${what} as a possible scam.</b> ${plural(n, "This report hasn't", "These reports haven't")} been confirmed yet, so check directly with the person or business before you pay.`;
}

// ================================================================ Name check
// to: { type: 'bsb', name, bsb, acc } or { type: 'payid', payid }
async function nameCheck(to, isBusiness) {
  to = { type: to.type, name: String(to.name || '').trim().slice(0, 140), bsb: String(to.bsb || '').slice(0, 10), acc: String(to.acc || '').slice(0, 12), payid: String(to.payid || '').slice(0, 254) };
  const items = [], flags = {};
  const add = (level, html) => items.push({ level, html });
  let cop = null, pid = null, key, name = to.name;
  if (to.type === 'payid') {
    key = S.normId(to.payid);
    pid = await S.payid.resolve(key);
    if (!pid.found) return { found: false, key };
    name = pid.name;
  } else {
    key = digits(to.bsb) + digits(to.acc);
    cop = await S.cop.check({ bsb: to.bsb, acc: to.acc, name: to.name });
  }
  const intel = await S.intel.check(key);
  if (cop) {
    if (cop.result === 'match') { add('ok', `✓ <b>Name matches.</b> This account belongs to ${esc(to.name)}.`); flags.match = true; }
    else if (cop.result === 'close') { add('warn', `<b>Close match.</b> The name on this account is similar to "${esc(to.name)}", but not exactly the same. Check the spelling with the person or business.`); flags.close = true; }
    else if (cop.result === 'no_match') { add('bad', `✗ <b>Name doesn't match.</b> This account doesn't belong to "${esc(to.name)}". Scammers often use a real name with their own account. Check the details directly with the person or business.`); flags.mismatch = true; }
    else add('warn', "<b>We couldn't check the name on this account.</b> Only continue if you got these details directly from the person or business.");
    if (isBusiness && cop.accountType === 'personal') { add('bad', '<b>This is a personal account, not a business account.</b> Real businesses usually get paid into a business account. Check with the business before you pay.'); flags.personal = true; }
  } else {
    add('ok', `This PayID is registered to <b>${esc(pid.name)}</b>. Make sure that's who you mean to pay.`);
    if (isBusiness && pid.type === 'personal') { add('bad', '<b>This PayID belongs to a personal account, not a business.</b> Real businesses usually get paid into a business account.'); flags.personal = true; }
  }
  if (intel.reports) add(intel.confirmed ? 'bad' : 'warn', '🚩 ' + reportText(intel.reports, intel.confirmed, to.type === 'payid' ? 'PayID' : 'account'));
  if (intel.newAccount) add('warn', '<b>This account is very new</b>, or has suddenly started receiving payments from lots of new people. Scammers often use accounts like this.');
  return { found: true, key, name, sameBank: cop ? cop.sameBank : null, intel, items, flags };
}

// ================================================================ Scam Risk Score
function assess({ amt, desc, balance, known, flags, intel, invoice, plan }) {
  const reasons = []; let s = 0;
  const add = (n, why) => { s += n; if (why) reasons.push(why); };
  if (intel.reports && intel.confirmed) add(50, `${intel.reports} ${plural(intel.reports, 'customer has', 'customers have')} reported this account as a scam, and our fraud team has confirmed it.`);
  else if (intel.reports) add(Math.min(35, 10 + 5 * intel.reports), `${intel.reports} ${plural(intel.reports, 'customer has', 'customers have')} reported this account as a possible scam.`);
  if (flags.mismatch) add(30, "The name you entered doesn't match the account.");
  if (flags.personal) add(20, "You're paying a business, but this is a personal account.");
  if (intel.newAccount) add(20, 'The account is very new, or has suddenly started receiving payments from lots of people.');
  if (invoice) {
    if (invoice.detailsChanged) add(30, "The business's bank details have changed since you last paid them.");
    if (invoice.abnProblem) add(30, String(invoice.abnProblem));
    if (invoice.edited) add(25, 'The invoice shows signs of being edited, such as bank details in a different font.');
    if (invoice.lookalike) add(25, "The invoice email came from an address that doesn't match the business.");
    if (invoice.changedWording) add(15, 'The invoice email says the bank details changed, or asks you to pay urgently.');
    if (invoice.newAbn) add(15, "The business's ABN was registered less than 12 months ago.");
    if (invoice.verified) add(-15);
  }
  if (!known) add(15, "You haven't paid this account before.");
  const big = amt >= BIG && !(known && known.times >= 3);
  const planned = big && !!plan && amt <= plan.amt * PLAN_MARGIN;
  const forced = big && !planned;
  if (forced) add(20, `This is a big payment (${money(BIG)} or more) to someone you don't pay regularly, and it wasn't planned.`);
  if (planned) add(-15);
  if (amt > USUAL * 10) add(20, `${money(amt)} is much more than you usually send (around ${money(USUAL)}).`);
  else if (amt > USUAL * 4) add(10, `${money(amt)} is more than you usually send (around ${money(USUAL)}).`);
  if (amt > balance * 0.5) add(10, 'This would use more than half of your balance.');
  const hits = scamWords.filter(w => String(desc || '').toLowerCase().includes(w));
  if (hits.length) add(15, `The description mentions "${hits.join('", "')}", which is common in scams.`);
  if (known && known.times >= 3) add(-20);
  if (flags.match) add(-10);
  return { score: Math.max(0, Math.min(100, s)), reasons, forced, overPlan: big && !!plan && !planned, planAmt: plan ? plan.amt : null };
}

async function reviewPayment(body) {
  const to = body.to || {};
  const amt = parseAmt(body.amt), balance = Number(body.balance);
  if (to.type === 'bsb') {
    if (!String(to.name || '').trim()) return { error: 'Enter the account name.' };
    if (digits(to.bsb).length !== 6) return { error: 'BSB must be 6 digits.' };
    const a = digits(to.acc).length; if (a < 6 || a > 9) return { error: 'Account number must be 6 to 9 digits.' };
  } else if (to.type === 'payid') {
    if (!S.normId(to.payid)) return { error: 'Enter a PayID.' };
  } else return { error: 'Choose BSB and account, or PayID.' };
  if (!(amt > 0)) return { error: 'Enter an amount.' };
  if (isFinite(balance) && amt > balance) return { error: 'Not enough money in this account.' };

  const nc = await nameCheck(to, !!body.isBusiness);
  if (!nc.found) return { error: "This PayID isn't registered, so payments can't be sent to it. Check it with the person or business you're paying." };
  // A saved payee's account with a name that doesn't match isn't treated as someone you know
  const known = body.known && !nc.flags.mismatch ? { times: Number(body.known.times) || 0 } : null;
  const risk = assess({ amt, desc: body.desc, balance, known, flags: nc.flags, intel: nc.intel, invoice: body.invoice || null, plan: body.plan && body.plan.amt > 0 ? { amt: Number(body.plan.amt) } : null });
  return { name: nc.name, key: nc.key, sameBank: nc.sameBank, items: nc.items, flags: nc.flags, intel: nc.intel, knownCounts: !!known, risk };
}

// ================================================================ Answers to the 3 scam questions
const answerReasons = [
  'Someone contacted you out of the blue and asked you to pay. This is how most scams start.',
  'You got the bank details from an email, text or call. Scammers send fake invoices and "updated bank details" this way.',
  "You're being rushed or asked to keep it secret. Real people and businesses don't do this.",
];
function answersVerdict({ score, answers, reported }) {
  const a = Array.isArray(answers) ? answers.slice(0, QUESTIONS).map(v => (v ? 1 : 0)) : [];
  if (a.length < QUESTIONS) return { error: 'Please answer all three questions.' };
  const yes = a.reduce((x, y) => x + y, 0);
  const total = Math.min(100, (Number(score) || 0) + yes * 15);
  const strong = yes > 0 || !!reported || total >= 70;
  return { total, strong, level: total >= 70 ? 'very high' : 'high', reasons: a.map((v, i) => (v ? answerReasons[i] : null)).filter(Boolean) };
}

// ================================================================ Invoices
const isBankLine = l => /\bBSB\b|\bAccount\s*(name|no\.?|number|#)/i.test(l);
const freeMail = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com', 'bigpond.com', 'proton.me'];
// Font family from a PDF font name: "BAAAAA+ArialMT" -> "Arial", "TimesNewRomanPS-BoldMT" -> "TimesNewRoman"
const prettyFont = f => String(f || '').replace(/^[A-Z]{6}\+/, '').replace(/[-,].*$/, '').replace(/(PSMT|PS|MT)$/, '');
const sameFont = (a, b) => prettyFont(a).toLowerCase() === prettyFont(b).toLowerCase();

function parseInvoice(text) {
  const t = String(text || '').replace(/\r/g, '');
  const g = re => { const m = t.match(re); return m ? m[1].trim() : ''; };
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const start = lines.findIndex(l => /^(tax )?invoice$/i.test(l));
  let business = start >= 0 ? (lines[start + 1] || '') : '';
  if (!business) { const ai = lines.findIndex(l => /\bABN\b|\bEIN\b|\bNZBN\b/i.test(l)); business = ai > 0 ? lines[ai - 1] : ''; }
  return {
    business,
    abn: digits(g(/\bABN[:\s#]*((?:\d\s?){11})/i)),
    overseas: g(/\b(EIN[:\s#]*\d{2}-?\d{7})/i) || g(/\b(UTR[:\s#]*(?:\d\s?){10})/i) || g(/\b(NZBN[:\s#]*(?:\d\s?){13})/i) || g(/(Companies House(?: No\.?| number)?[:\s#]*[A-Z0-9]{8})/i),
    accName: g(/Account name[:\s]*([^\n]+)/i),
    bsb: digits(g(/\bBSB[:\s#]*(\d{3}[-\s]?\d{3})/i)),
    acc: digits(g(/\bAcc(?:ount)?\.?\s*(?:No\.?|Number|#)[:\s#]*((?:\d[\s-]?){5,9}\d)/i)),
    amount: parseAmt(g(/(?:Total due|Amount due|Balance due|Total)[^\d\n]*\$?\s*([\d,]+\.\d{2})/i)),
    ref: g(/(?:Reference|Invoice number|Invoice No\.?|Invoice #)[:\s#]*([A-Z0-9-]+)/i),
    gst: /\bGST\b/i.test(t),
  };
}
function parseEmail(text) {
  const froms = Array.from(String(text || '').matchAll(/^\s*From:\s*(.*)$/gim))
    .map(m => ((m[1].match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [''])[0]).toLowerCase()).filter(Boolean);
  return froms.length ? { from: froms[0], all: froms, text: String(text) } : null;
}

// Signs the invoice was edited: fonts, text size, PDF edit history, image editing
function documentChecks(doc, history, ok, warn, bad) {
  const res = { edited: false, mainFont: null };
  if (!doc || !Array.isArray(doc.lines)) return res;
  const lines = doc.lines.slice(0, 2000).filter(l => l && typeof l.text === 'string').map(l => ({ text: l.text.slice(0, 500), font: l.font ? String(l.font).slice(0, 100) : null, size: Number(l.size) || 0 }));
  const bank = lines.filter(l => isBankLine(l.text));
  const body = lines.filter(l => !isBankLine(l.text) && l.text.length > 3);
  if (bank.length && body.length >= 3) {
    if (bank.some(l => l.font)) {
      const fam = f => (f ? prettyFont(f) : null);
      const counts = {}; body.forEach(l => { const k = fam(l.font); if (k) counts[k] = (counts[k] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      res.mainFont = top ? top[0] : null;
      const odd = Array.from(new Set(bank.map(l => fam(l.font)))).filter(fn => fn && fn !== res.mainFont && (counts[fn] || 0) <= 1);
      if (res.mainFont && odd.length) { bad(`The bank details use a different font (${esc(prettyFont(odd[0]))}) from the rest of the invoice (${esc(prettyFont(res.mainFont))}). This often means the bank details were changed after the invoice was made.`); res.edited = true; }
      else if (res.mainFont) ok(`The bank details use the same font as the rest of the invoice (${esc(prettyFont(res.mainFont))}).`);
    }
    const sizes = body.map(l => Number(l.size) || 0).sort((a, b) => a - b), med = sizes[Math.floor(sizes.length / 2)];
    if (med > 0 && bank.some(l => Math.abs((Number(l.size) || 0) - med) / med > 0.15)) { bad('The bank details are a different text size from the rest of the invoice, as if they were pasted in.'); res.edited = true; }
    else if (!bank.some(l => l.font)) ok('The bank details are the same text size as the rest of the invoice.');
  }
  const m = doc.meta;
  if (m) {
    const editors = /ilovepdf|smallpdf|pdfescape|sejda|pdffiller|dochub|pdf-xchange|foxit phantom|pdfelement|photopea|canva/i;
    const acctSw = /xero|myob|quickbooks|intuit|reckon|freshbooks|zoho|wave|sage/i;
    const changed = !!(m.created && m.modified && new Date(m.modified) - new Date(m.created) > 60000);
    if (changed) { bad(`The PDF was changed on ${fmtWhen(m.modified)}, after it was first created on ${fmtWhen(m.created)}.`); res.edited = true; }
    if (m.producer && editors.test(m.producer)) { bad(`The PDF was last saved by ${esc(m.producer)}, a PDF editing tool, not the accounting software that usually makes invoices.`); res.edited = true; }
    else if (m.producer && acctSw.test(m.producer) && !changed) ok(`The PDF was made by ${esc(m.producer)} and hasn't been changed since.`);
    if (m.eofCount > 1) warn(`The PDF has been saved ${m.eofCount} times. This can mean it was edited after it was made.`);
  }
  if (doc.editor) { bad(`This image was edited with ${esc(doc.editor)}.`); res.edited = true; }
  if (history && history.font && res.mainFont) {
    if (sameFont(res.mainFont, history.font)) ok('Same font and layout as previous invoices from this business.');
    else warn(`This invoice uses a different font (${esc(prettyFont(res.mainFont))}) from previous invoices from this business (${esc(history.font)}).`);
  }
  return res;
}

// body: { text, doc, fields (null on first read), history: { [abn]: { bsb, acc, last, font, domain } } }
async function analyzeInvoice(body) {
  const text = String(body.text || '').slice(0, 200000); // plenty for any invoice or email
  const parsed = parseInvoice(text);
  const em = parseEmail(text);
  const f = body.fields || {
    business: parsed.business,
    abn: parsed.abn ? fmtAbn(parsed.abn) : parsed.overseas,
    accountName: parsed.accName || parsed.business,
    bsb: parsed.bsb ? fmtBsb(parsed.bsb) : '',
    account: parsed.acc,
    amount: parsed.amount > 0 ? parsed.amount.toFixed(2) : '',
    reference: parsed.ref,
  };
  const fields = {
    business: String(f.business || '').trim().slice(0, 140), abn: String(f.abn || '').trim().slice(0, 60), accountName: String(f.accountName || '').trim().slice(0, 140),
    bsb: String(f.bsb || '').trim().slice(0, 10), account: String(f.account || '').trim().slice(0, 12), amount: String(f.amount || '').trim().slice(0, 20), reference: String(f.reference || '').trim().slice(0, 40),
  };
  const history = body.history && typeof body.history === 'object' ? body.history : {};
  const biz = fields.business, abnRaw = fields.abn;
  const abn = /^[\d\s]+$/.test(abnRaw) ? digits(abnRaw) : '';
  const name = fields.accountName, bsb = digits(fields.bsb), acc = digits(fields.account);
  const hasAcct = bsb.length === 6 && acc.length >= 6;
  const overseasRaw = !abn && (abnRaw || parsed.overseas) ? (abnRaw || parsed.overseas) : '';
  const [a, cop, intel, ovs] = await Promise.all([
    abn && S.abn.isValid(abn) ? S.abn.lookup(abn) : null,
    hasAcct && name ? S.cop.check({ bsb, acc, name }) : null,
    hasAcct ? S.intel.check(bsb + acc) : null,
    overseasRaw ? S.overseas.lookup(overseasRaw) : null,
  ]);

  const items = [], flags = {};
  const ok = h => items.push(['ok', h]), warn = h => items.push(['warn', h]), bad = h => items.push(['bad', h]), head = h => items.push(['head', h]);
  let abnActive = false, nameMatches = false, acctMatches = false;

  head('The business');
  if (abn) {
    if (!S.abn.isValid(abn)) { bad(`ABN ${esc(fmtAbn(abn))} isn't a valid ABN number.`); flags.abnProblem = "The ABN on the invoice isn't a valid number."; }
    else if (!a || !a.found) { warn(`ABN ${esc(fmtAbn(abn))} wasn't found on the Australian Business Register.`); flags.abnProblem = "The ABN on the invoice isn't registered."; }
    else if (a.status !== 'Active') { bad(`ABN ${esc(fmtAbn(abn))} was cancelled${a.cancelledFrom ? ' in ' + esc(fmtMonthYear(a.cancelledFrom)) : ''}. This business is no longer registered.`); flags.abnProblem = 'The ABN on the invoice has been cancelled.'; }
    else {
      abnActive = true;
      ok(`ABN is active, registered to ${esc(a.name)} since ${esc(fmtMonthYear(a.activeFrom))}.`);
      if (monthsSince(a.activeFrom) < 12) { warn("This business is new (ABN registered less than 12 months ago). That's not a problem on its own, but take a little extra care."); flags.newAbn = true; }
      if (parsed.gst && !a.gst) warn("The invoice charges GST, but the business isn't registered for GST.");
      if (biz) {
        if (sameBusiness(biz, a)) { ok('Business name on the invoice matches the ABN record.'); nameMatches = true; }
        else { bad(`The invoice says "${esc(biz)}", but this ABN belongs to ${esc(a.name)}.`); flags.abnProblem = "The business name on the invoice doesn't match its ABN."; }
      }
    }
  } else if (ovs) {
    if (ovs.verifiable && ovs.found) ok(`${esc(ovs.type)} found on the ${esc(ovs.country)} business register${ovs.name ? ': ' + esc(ovs.name) : ''}.`);
    else if (ovs.verifiable) warn(`This ${esc(ovs.type)} wasn't found on the ${esc(ovs.country)} business register.`);
    else warn(`Overseas business number found (${esc(overseasRaw)}). ${esc(ovs.reason)} Check this business yourself before paying.`);
  } else {
    warn('No ABN found on this invoice. Most Australian businesses show their ABN on invoices.');
  }

  head('Bank account');
  if (intel && intel.reports) (intel.confirmed ? bad : warn)(reportText(intel.reports, intel.confirmed, 'bank account'));
  if (cop) {
    if (cop.result === 'match') {
      if (a && a.found && a.status === 'Active' && !sameBusiness(name, a)) bad(`The bank account is in the name "${esc(name)}", which isn't the business on the ABN (${esc(a.name)}).`);
      else { ok(`Bank account belongs to ${esc(name)}, the same as the business.`); acctMatches = true; }
    } else if (cop.result === 'close') warn(`The bank account name is similar to "${esc(name)}" but not exactly the same.`);
    else if (cop.result === 'no_match') bad(`This bank account doesn't belong to ${esc(name)}. The bank details on this invoice may have been changed.`);
    else warn("We couldn't check who owns this bank account.");
    if (cop.accountType === 'personal') bad('The bank account is a personal account, not a business account. Real businesses usually get paid into a business account.');
  } else if (!hasAcct) warn('Enter the BSB and account number from the invoice to check them.');
  if (intel && intel.newAccount) warn('The bank account is very new, or has suddenly started receiving payments from lots of new people.');
  const h = abn && history[abn] && typeof history[abn] === 'object' ? history[abn] : null;
  if (h && hasAcct) {
    if (digits(h.bsb) + digits(h.acc) === bsb + acc) ok(`Same bank details as your last payment to this business (${esc(h.last)}).`);
    else { bad(`This business's bank details have changed since you last paid them (${esc(h.last)}). Call the business on a number you find yourself, not the one on the invoice, to confirm.`); flags.detailsChanged = true; }
  }

  flags.emailDomain = null;
  if (em) {
    head('The email');
    const dom = em.from.split('@')[1], real = h && h.domain;
    if (real && (dom === real || dom.endsWith('.' + real))) { ok(`Email sent from ${esc(dom)}, the same address as this business's previous invoices.`); flags.emailDomain = dom; }
    else if (freeMail.includes(dom)) { bad(`Email sent from a free ${esc(dom)} address, not the business's own email${real ? ' (' + esc(real) + ')' : ''}.`); flags.lookalike = true; }
    else if (real) {
      const root = real.split('.')[0];
      bad(dom.includes(root) || S.lev(dom, real) <= 3
        ? `Email sent from ${esc(dom)}, which looks like but isn't the address this business used before (${esc(real)}).`
        : `Email sent from ${esc(dom)}, which isn't the address this business used before (${esc(real)}).`);
      flags.lookalike = true;
    } else { warn(`This is the first email we've seen from this business, so we can't confirm ${esc(dom)} is theirs.`); flags.emailDomain = dom; }
    if (/(new|updated|changed|change of|change in)\s+(our\s+)?(bank|banking|account|payment)\s+details|bank\s+details\s+(have\s+)?(changed|been\s+updated)|pay\b[^.\n]{0,40}\b(urgently|immediately|today)|\burgent/i.test(em.text)) {
      bad('The email says the bank details have changed, or asks you to pay urgently. Both are common signs of invoice scams.'); flags.changedWording = true;
    }
    const others = Array.from(new Set(em.all)).filter(x => x !== em.from);
    if (others.length) { bad(`Earlier messages in this email chain came from a different address (${esc(others[0])}). The business's email may have been hacked or copied.`); flags.lookalike = true; }
  }

  head('The invoice itself');
  const dc = documentChecks(body.doc, h, ok, warn, bad);
  flags.edited = dc.edited;
  flags.mainFont = dc.mainFont ? prettyFont(dc.mainFont) : null;
  flags.verified = abnActive && nameMatches && acctMatches && !flags.detailsChanged && !flags.lookalike && !flags.changedWording && !flags.edited && !(intel && intel.reports);

  // Section headings only appear when they have checks under them
  const shown = items.filter((it, i) => it[0] !== 'head' || (items[i + 1] && items[i + 1][0] !== 'head'));
  const nBad = items.filter(i => i[0] === 'bad').length, nWarn = items.filter(i => i[0] === 'warn').length;
  const level = nBad ? 'bad' : nWarn ? 'warn' : 'ok';
  const summary = nBad ? `${nBad} serious ${plural(nBad, 'problem', 'problems')} found. This could be a scam.` : nWarn ? `${nWarn} ${plural(nWarn, 'thing', 'things')} to double-check.` : 'Everything checks out.';
  const verdict = {
    bad: { icon: '✗', title: 'This could be a scam', text: `We found ${nBad} serious ${plural(nBad, 'problem', 'problems')}. We recommend you don't pay until you've called the business on a phone number you find yourself. It's still your decision.` },
    warn: { icon: '!', title: 'A few things to double-check', text: `${nWarn} ${plural(nWarn, 'thing needs', 'things need')} a second look before you pay.` },
    ok: { icon: '✓', title: 'Everything checks out', text: 'The business and bank details look right.' },
  }[level];
  return {
    fields, email: em ? { from: em.from } : null, items: shown, level, summary, verdict,
    check: Object.assign({}, flags, { abn, business: a && a.found ? a.name : biz, level, summary, key: bsb + acc }),
  };
}

// ================================================================ Message checker
function checkMessage(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return { level: 'none', findings: [] };
  const f = [];
  if (/https?:\/\/|www\.|\.co\b|\.com\b/.test(t)) f.push('Contains a link. Westpac never texts you a link to log in.');
  if (/suspend|locked|unusual activity|verify your/.test(t)) f.push('Says something is wrong with your account, to make you panic.');
  if (/(new|updated|changed|change of)\s+(our\s+)?(bank|account|payment)\s+details|bank\s+details\s+(have\s+)?changed|new account/.test(t)) f.push('Says their bank details have changed. Always confirm this by calling the business on a number you find yourself.');
  if (/urgent|within \d+ hours|today|immediately|right now/.test(t)) f.push('Pressures you to act fast.');
  if (/guaranteed|returns|crypto|bitcoin|investment/.test(t)) f.push('Promises guaranteed or unrealistic returns.');
  if (/transfer|\$\d|gift card|\bpay\b|payment|bsb/.test(t)) f.push('Asks you to send money.');
  if (/\bato\b|police|government|tax debt/.test(t)) f.push('Pretends to be from an authority.');
  return { level: f.length >= 2 ? 'bad' : f.length === 1 ? 'warn' : 'ok', findings: f };
}

// ================================================================ Big payment plan
function startPlan({ type, amt, answers }) {
  const amount = parseAmt(amt);
  if (!(amount >= BIG)) return { ok: false, error: `Big payments are ${money(BIG)} or more.` };
  const a = Array.isArray(answers) ? answers.slice(0, QUESTIONS) : [];
  if (a.length < QUESTIONS || a.some(v => v !== 0 && v !== 1 && v !== true && v !== false)) return { ok: false, error: 'Please answer all three questions.' };
  if (a.some(v => v === 1 || v === true)) return { ok: false, refused: true };
  return { ok: true, plan: { start: Date.now(), type: String(type || 'Other').slice(0, 40), amt: amount } };
}

module.exports = { BIG, nameCheck, reviewPayment, answersVerdict, analyzeInvoice, checkMessage, startPlan, parseInvoice, parseEmail };
