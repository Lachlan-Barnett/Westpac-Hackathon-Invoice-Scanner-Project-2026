'use strict';
/*
 * External services the checks rely on.
 *
 * MOCK=true (default): answers come from the demo database (server/db.js), so everything works offline.
 * MOCK=false: calls the real services configured with environment variables. Most are only
 * available to banks (through Westpac's own systems or industry memberships).
 *
 *  Service                Real source                                              Setting
 *  abn.lookup             ABN Lookup web services (Australian Business Register)   ABN_GUID (free)
 *  cop.check              Confirmation of Payee (Australian Payments Plus)          COP_URL (banks only)
 *  payid.resolve          NPP Addressing Service (PayID name lookup)               PAYID_URL (banks only)
 *  intel.check / report   Westpac fraud platform + shared scam intelligence        INTEL_URL (Westpac internal)
 *  bpay.biller            BPAY biller directory                                    BPAY_URL (BPAY members)
 *  overseas.lookup        UK Companies House API, NZBN API                          COMPANIES_HOUSE_KEY
 *  kyc.profile            Westpac customer and KYC records                          (Westpac internal)
 */
const db = require('./db');

const CONFIG = {
  MOCK: process.env.MOCK !== 'false',
  ABN_GUID: process.env.ABN_GUID || '',
  COP_URL: process.env.COP_URL || '',
  PAYID_URL: process.env.PAYID_URL || '',
  INTEL_URL: process.env.INTEL_URL || '',
  BPAY_URL: process.env.BPAY_URL || '',
  COMPANIES_HOUSE_KEY: process.env.COMPANIES_HOUSE_KEY || '',
};
const REPORTS_PER_HOUR = 10;
const NEW_ACCOUNT_DAYS = 60;

// ---------------------------------------------------------------- helpers
const digits = s => String(s || '').replace(/\D/g, '');
const normId = s => String(s || '').trim().toLowerCase().replace(/\s/g, '').slice(0, 254);
function normName(n) {
  return String(n || '').slice(0, 200).toLowerCase()
    .replace(/\b(pty|ltd|limited|proprietary|the|trading as|t\/as|co|company|inc|llc)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}
function lev(a, b) {
  a = a.slice(0, 200); b = b.slice(0, 200);
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i].concat(Array(b.length).fill(0)));
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return m[a.length][b.length];
}
// match | close | no_match (how Confirmation of Payee services describe results)
function compareNames(entered, actual) {
  const a = normName(entered), b = normName(actual);
  if (!a || !b) return 'no_match';
  if (a === b) return 'match';
  const ratio = lev(a, b) / Math.max(a.length, b.length);
  if (ratio <= 0.2 || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a)))) return 'close';
  return 'no_match';
}
// Westpac BSBs start with 03 or 73. Used to decide what we can see directly.
const isWestpacBsb = bsb => /^(03|73)/.test(digits(bsb));
const daysSince = isoDate => (Date.now() - new Date(isoDate).getTime()) / 86400000;

async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Service error ' + r.status);
  return r.json();
}

// ---------------------------------------------------------------- ABN (Australian Business Register)
const abn = {
  // ATO checksum: subtract 1 from the first digit, multiply by weights, total must divide by 89
  isValid(value) {
    const a = digits(value);
    if (a.length !== 11) return false;
    const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const d = a.split('').map(Number); d[0] -= 1;
    return d.reduce((sum, n, i) => sum + n * w[i], 0) % 89 === 0;
  },
  async lookup(value) {
    const a = digits(value);
    if (CONFIG.MOCK) {
      const r = db.abn(a);
      if (!r) return { found: false, abn: a };
      return { found: true, abn: a, name: r.name, entityName: r.entity_name, status: r.status, activeFrom: r.active_from,
        cancelledFrom: r.cancelled_from, gst: !!r.gst, businessNames: JSON.parse(r.business_names || '[]') };
    }
    if (!CONFIG.ABN_GUID) return { found: false, abn: a, error: 'ABN_GUID not set' };
    try {
      // ABN Lookup returns JSONP: callback({...})
      const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${a}&callback=cb&guid=${encodeURIComponent(CONFIG.ABN_GUID)}`;
      const raw = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).text();
      const data = JSON.parse(raw.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, ''));
      if (!data || !data.Abn) return { found: false, abn: a };
      const names = Array.isArray(data.BusinessName) ? data.BusinessName : [];
      const active = data.AbnStatus === 'Active';
      return {
        found: true, abn: a, name: names[0] || data.EntityName, entityName: data.EntityName,
        status: active ? 'Active' : 'Cancelled', activeFrom: data.AbnStatusEffectiveFrom,
        cancelledFrom: active ? null : data.AbnStatusEffectiveFrom, gst: !!data.Gst, businessNames: names,
      };
    } catch (e) { return { found: false, abn: a, error: e.message }; }
  },
};

// ---------------------------------------------------------------- Confirmation of Payee
const cop = {
  // Never returns the real account holder's name (privacy). accountType only for Westpac accounts.
  async check({ bsb, acc, name }) {
    const key = digits(bsb) + digits(acc), sameBank = isWestpacBsb(bsb);
    if (CONFIG.MOCK) {
      const r = db.account(key);
      if (!r) return { result: 'unavailable', sameBank };
      const out = { result: compareNames(name, r.holder_name), sameBank };
      if (sameBank) out.accountType = r.account_type;
      return out;
    }
    if (!CONFIG.COP_URL) return { result: 'unavailable', sameBank };
    try { return Object.assign({ sameBank }, await postJson(CONFIG.COP_URL, { bsb: digits(bsb), account: digits(acc), name })); }
    catch (e) { return { result: 'unavailable', sameBank }; }
  },
};

// ---------------------------------------------------------------- PayID
const payid = {
  async resolve(id) {
    const k = normId(id);
    if (CONFIG.MOCK) { const r = db.payid(k); return r ? { found: true, name: r.holder_name, type: r.payid_type } : { found: false }; }
    if (!CONFIG.PAYID_URL) return { found: false };
    try { return await postJson(CONFIG.PAYID_URL, { payid: k }); } catch (e) { return { found: false }; }
  },
};

// ---------------------------------------------------------------- Scam intelligence
const intel = {
  // reports = confirmed reports + reports from identity-verified customers (one each)
  async check(key) {
    const k = normId(key);
    if (CONFIG.MOCK) {
      const p = db.payid(k);
      const acctKey = p ? p.account_key : k;
      const base = db.intel(acctKey) || db.intel(k);
      const acct = db.account(acctKey);
      let reports = (base ? base.confirmed_reports : 0) + db.verifiedReportCount(k);
      if (acctKey !== k) reports += db.verifiedReportCount(acctKey);
      return { reports, confirmed: !!(base && base.confirmed), newAccount: !!(acct && daysSince(acct.opened_on) < NEW_ACCOUNT_DAYS) };
    }
    if (!CONFIG.INTEL_URL) return { reports: 0, confirmed: false, newAccount: false };
    try { return await postJson(CONFIG.INTEL_URL + '/check', { key: k }); } catch (e) { return { reports: 0, confirmed: false, newAccount: false }; }
  },
  // A customer reports an account or PayID. Rules: identity-verified customers only, once per account, 10 an hour.
  async report(key, customerId, note) {
    const k = normId(key);
    if (!/^\d{12,15}$/.test(k) && !/^[a-z0-9@._+-]{6,254}$/.test(k)) return { ok: false, status: 400, message: "That doesn't look like an account or PayID." };
    const c = db.customer(customerId);
    if (!c || c.kyc_status !== 'verified') return { ok: false, status: 403, message: 'Only customers who have verified their identity can report scams.' };
    if (db.hasReported(k, customerId)) return { ok: false, already: true, message: "You've already reported this account. Thank you." };
    if (db.reportsSince(customerId, new Date(Date.now() - 3600000).toISOString()) >= REPORTS_PER_HOUR) return { ok: false, status: 429, message: "You've made a lot of reports in the last hour. Please try again later or call us." };
    if (!CONFIG.MOCK && CONFIG.INTEL_URL) { try { await postJson(CONFIG.INTEL_URL + '/report', { key: k, note }); } catch (e) { /* recorded locally anyway */ } }
    db.addReport(k, customerId, String(note || '').slice(0, 200));
    return { ok: true };
  },
};

// ---------------------------------------------------------------- BPAY
const bpay = {
  async biller(code) {
    const c = digits(code).slice(0, 10);
    if (CONFIG.MOCK) { const r = db.biller(c); return r ? { found: true, name: r.name } : { found: false }; }
    if (!CONFIG.BPAY_URL) return { found: false };
    try { return await postJson(CONFIG.BPAY_URL, { billerCode: c }); } catch (e) { return { found: false }; }
  },
};

// ---------------------------------------------------------------- Overseas business numbers
const overseas = {
  async lookup(raw) {
    const t = String(raw || '').slice(0, 200);
    if (/\bEIN\b/i.test(t)) return { type: 'EIN', country: 'USA', verifiable: false, reason: 'The USA has no public register of EINs.' };
    if (/\bUTR\b/i.test(t)) return { type: 'UTR', country: 'UK', verifiable: false, reason: 'A UK UTR is a private tax number, so it cannot be checked.' };
    const ch = t.match(/Companies House[^A-Z0-9]*([A-Z0-9]{8})/i);
    if (ch) {
      const num = ch[1].toUpperCase();
      if (CONFIG.MOCK) { const r = db.overseas('companies_house', num); return { type: 'Companies House number', country: 'UK', verifiable: true, found: !!(r && r.status === 'active'), name: r && r.name }; }
      if (!CONFIG.COMPANIES_HOUSE_KEY) return { type: 'Companies House number', country: 'UK', verifiable: false, reason: 'Companies House API key not set.' };
      try {
        const r = await fetch('https://api.company-information.service.gov.uk/company/' + num, { headers: { Authorization: 'Basic ' + Buffer.from(CONFIG.COMPANIES_HOUSE_KEY + ':').toString('base64') }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) return { type: 'Companies House number', country: 'UK', verifiable: true, found: false };
        const d = await r.json();
        return { type: 'Companies House number', country: 'UK', verifiable: true, found: d.company_status === 'active', name: d.company_name };
      } catch (e) { return { type: 'Companies House number', country: 'UK', verifiable: false, reason: 'Companies House could not be reached.' }; }
    }
    const nz = t.match(/\bNZBN[^0-9]*((?:\d\s?){13})/i);
    if (nz) {
      if (CONFIG.MOCK) { const r = db.overseas('nzbn', digits(nz[1])); return { type: 'NZBN', country: 'NZ', verifiable: true, found: !!(r && r.status === 'active'), name: r && r.name }; }
      return { type: 'NZBN', country: 'NZ', verifiable: false, reason: 'NZBN API key not set.' };
    }
    return { type: 'Business number', country: 'overseas', verifiable: false, reason: 'We do not recognise this business number.' };
  },
};

// ---------------------------------------------------------------- Customer profile and KYC
const kyc = {
  profile(customerId) {
    const c = db.customer(customerId);
    if (!c) return null;
    return {
      firstName: c.first_name, lastName: c.last_name, customerSince: c.customer_since,
      kyc: { status: c.kyc_status, level: c.kyc_level, verifiedAt: c.kyc_verified_at, riskRating: c.risk_rating,
        documents: db.kycDocuments(customerId).map(d => ({ type: d.doc_type, number: d.number_masked, verifiedVia: d.verified_via, verifiedAt: d.verified_at, expires: d.expires, status: d.status })),
        checks: db.kycChecks(customerId).map(k => ({ type: k.check_type, result: k.result, checkedAt: k.checked_at })) },
    };
  },
};

module.exports = { CONFIG, digits, normId, normName, lev, compareNames, isWestpacBsb, abn, cop, payid, intel, bpay, overseas, kyc };
