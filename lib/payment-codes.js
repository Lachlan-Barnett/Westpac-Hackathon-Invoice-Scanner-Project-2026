// QR codes and PayIDs on invoices.
//  - decodeQr: finds a QR code in a PNG or JPG invoice
//  - parseQr: works out what the QR code pays (a PayID, a BSB and account, a payment web page, BPAY)
//  - paymentCodeChecks: does the PayID belong to this business, and does the QR code pay the same place as the printed details?
const jsQR = require("jsqr");
const { PNG } = require("pngjs");
const jpeg = require("jpeg-js");
const db = require("./db");
const U = require("./util");

function decodeQr(buf, mime) {
  try {
    let img;
    if (/png/.test(mime) || buf.subarray(1, 4).toString("latin1") === "PNG") img = PNG.sync.read(buf);
    else if (/jpe?g/.test(mime) || (buf[0] === 0xff && buf[1] === 0xd8)) img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
    else return null;
    const data = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length);
    const code = jsQR(data, img.width, img.height);
    return code && code.data ? String(code.data).slice(0, 1000) : null;
  } catch (e) { console.warn("QR scan skipped:", e.message); return null; }
}

const normPayid = s => String(s || "").trim().toLowerCase().replace(/^payid:/, "").replace(/\s/g, "").slice(0, 254);
const looksPayid = s => /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s) || /^(\+?61|0)4\d{8}$/.test(s.replace(/[\s-]/g, "")) || /^\d{11}$/.test(s.replace(/\s/g, ""));

// EMVCo QR (used by payment QR codes): tag(2) length(2) value
function emv(text) {
  const out = {}; let i = 0;
  while (i + 4 <= text.length) {
    const tag = text.slice(i, i + 2), len = Number(text.slice(i + 2, i + 4));
    if (!/^\d\d$/.test(tag) || !(len >= 0)) return null;
    out[tag] = text.slice(i + 4, i + 4 + len); i += 4 + len;
  }
  return i === text.length ? out : null;
}

// What a QR code (or "pay to" text) asks you to pay
function parseQr(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (/^https?:\/\//i.test(t)) {
    try { const u = new URL(t); return { type: "url", url: t.slice(0, 300), domain: u.hostname.replace(/^www\./, "").toLowerCase(), secure: u.protocol === "https:", raw: t }; }
    catch { return { type: "text", raw: t }; }
  }
  if (/^000201/.test(t)) { // EMVCo merchant QR: look through the account templates (tags 26-51) for a PayID or BSB/account
    const top = emv(t);
    if (top) {
      for (let n = 26; n <= 51; n++) {
        const sub = top[String(n)] && emv(top[String(n)]);
        if (!sub) continue;
        for (const v of Object.values(sub)) {
          const p = normPayid(v);
          if (looksPayid(p)) return { type: "payid", payid: p, name: top["59"] || "", amount: Number(top["54"]) || 0, raw: t };
          const d = U.digits(v); if (d.length >= 12 && d.length <= 15) return { type: "account", bsb: d.slice(0, 6), account: d.slice(6), name: top["59"] || "", raw: t };
        }
      }
    }
  }
  const bsb = t.match(/BSB[:\s]*(\d{3})[-\s]?(\d{3})/i), acc = t.match(/(?:ACC(?:OUNT)?(?:\s*(?:NO|NUMBER))?)[:.\s#]*((?:\d[\s-]?){5,9}\d)/i);
  if (bsb && acc) return { type: "account", bsb: bsb[1] + bsb[2], account: U.digits(acc[1]), name: (t.match(/NAME[:\s]*([^\n;|]+)/i) || [])[1] || "", raw: t };
  const biller = t.match(/BILLER(?:\s*CODE)?[:\s]*(\d{3,10})/i);
  if (biller) return { type: "bpay", biller: biller[1], ref: ((t.match(/REF(?:ERENCE)?[:\s]*(\d+)/i) || [])[1]) || "", raw: t };
  const p = normPayid(t.replace(/^payid[:\s]*/i, ""));
  if (looksPayid(p)) return { type: "payid", payid: p.replace(/[\s-]/g, ""), raw: t };
  return { type: "text", raw: t.slice(0, 300) };
}

const payidRow = id => id ? db.get("SELECT * FROM payids WHERE payid = ?", [normPayid(id)]) : null;
const reported = key => key ? db.get("SELECT COUNT(*) AS n FROM scam_reports WHERE type = 'account' AND value = ?", [key]).n + db.get("SELECT COUNT(*) AS n FROM customer_reports WHERE key = ?", [key]).n : 0;
const PAY_SITES = ["stripe.com", "paypal.com", "square.link", "squareup.com", "xero.com", "myob.com", "quickbooks.intuit.com", "intuit.com", "invoice2go.com", "zeller.com.au", "tyro.com"];
const fmtKey = k => `BSB ${k.slice(0, 3)}-${k.slice(3, 6)}, account ${k.slice(6)}`;

// x: invoice fields (payid, qr, bsb, account_number, business_name, email ...); reg: business register entry
// compare(nameA, nameB) -> "match" | "close" | "no_match"
function paymentCodeChecks(x, reg, compare) {
  const C = [], label = "Checking PayID and QR code", src = "NPP PayID register + QR code on the invoice";
  const add = (title, status, detail, crit = false) => C.push({ label, title, status, detail, source: src, crit });
  const bizNames = [reg?.entity_name, ...String(reg?.trading_names || "").split(","), x.business_name].map(s => String(s || "").trim()).filter(Boolean);
  const belongs = name => bizNames.some(b => compare(name, b) !== "no_match");
  const printedKey = x.bsb && x.account_number ? U.digits(x.bsb) + U.digits(x.account_number) : "";

  // 1) PayID printed on the invoice
  const pid = x.payid ? payidRow(x.payid) : null;
  if (x.payid) {
    if (!pid) add("PayID isn't registered", "warn", `The PayID "${x.payid}" on the invoice isn't registered with any bank, so a payment to it would fail. Check it with the business.`);
    else if (reported(pid.account_key)) add("PayID account has been reported as a scam", "fail", `The PayID "${x.payid}" goes to an account that has been reported as a scam (${pid.holder_name}).`, true);
    else if (!belongs(pid.holder_name)) add("PayID belongs to someone else", "fail", `The PayID "${x.payid}" is registered to "${pid.holder_name}", not ${bizNames[0] || "this business"}.`, true);
    else if (pid.payid_type === "personal") add("PayID is a personal account", "warn", `The PayID "${x.payid}" is registered to ${pid.holder_name} as a personal account. Businesses usually use a business account.`);
    else add("PayID belongs to this business", "pass", `The PayID "${x.payid}" is registered to ${pid.holder_name}${printedKey && pid.account_key !== printedKey ? "" : " and pays the same account as the bank details on the invoice"}.`);
    if (pid && printedKey && pid.account_key !== printedKey && belongs(pid.holder_name))
      add("PayID and bank details go to different accounts", "warn", `The PayID pays ${fmtKey(pid.account_key)}, but the invoice also lists ${fmtKey(printedKey)}. Check which one the business wants you to use.`);
  }

  // 2) QR code on the invoice
  const q = x.qr;
  if (q && q.type === "payid") {
    const qp = payidRow(q.payid), printedPid = x.payid ? U.norm(x.payid) : "";
    const sameAsPrinted = (printedPid && U.norm(q.payid) === printedPid) || (qp && printedKey && qp.account_key === printedKey);
    if (!qp) add("QR code pays an unregistered PayID", "warn", `The QR code pays the PayID "${q.payid}", which isn't registered with any bank.`);
    else if (!sameAsPrinted && (printedPid || printedKey)) add("QR code pays a different account", "fail", `The QR code pays the PayID "${q.payid}" (registered to ${qp.holder_name}), not the ${printedPid ? `PayID "${x.payid}"` : "bank details"} printed on the invoice. Scammers stick their own QR code over real invoices.`, true);
    else if (!belongs(qp.holder_name)) add("QR code pays someone else", "fail", `The QR code pays the PayID "${q.payid}", registered to "${qp.holder_name}", not ${bizNames[0] || "this business"}.`, true);
    else if (reported(qp.account_key)) add("QR code account has been reported as a scam", "fail", `The QR code pays an account that has been reported as a scam.`, true);
    else add("QR code matches the invoice", "pass", `The QR code pays the PayID "${q.payid}", registered to ${qp.holder_name}, the same as the invoice.`);
  } else if (q && q.type === "account") {
    const key = q.bsb + q.account;
    if (printedKey && key !== printedKey) add("QR code pays a different account", "fail", `The QR code pays ${fmtKey(key)}, but the invoice says ${fmtKey(printedKey)}. Scammers stick their own QR code over real invoices.`, true);
    else if (reported(key)) add("QR code account has been reported as a scam", "fail", `The QR code pays ${fmtKey(key)}, which has been reported as a scam.`, true);
    else add("QR code matches the invoice", "pass", `The QR code pays ${fmtKey(key)}, the same account as the invoice.`);
  } else if (q && q.type === "url") {
    const real = reg?.email_domain || "";
    const paySite = PAY_SITES.find(d => q.domain === d || q.domain.endsWith("." + d));
    if (real && q.domain !== real && !q.domain.endsWith("." + real) && (U.lev(q.domain, real) <= 4 || q.domain.includes(real.split(".")[0])))
      add("QR code opens a look-alike website", "fail", `The QR code opens "${q.domain}", a look-alike of the business's real website "${real}".`, true);
    else if (!q.secure) add("QR code opens an insecure website", "warn", `The QR code opens ${q.url}, which isn't a secure (https) page. Don't enter card or bank details there.`);
    else if (paySite) add("QR code opens a payment page", "info", `The QR code opens a ${paySite} payment page. Check it shows ${bizNames[0] || "the business"} before you pay.`);
    else if (real && (q.domain === real || q.domain.endsWith("." + real))) add("QR code opens the business's website", "pass", `The QR code opens ${q.domain}, the business's registered website.`);
    else add("QR code opens an unknown website", "warn", `The QR code opens "${q.domain}", which isn't the business's registered website${real ? ` (${real})` : ""}. Pay using the bank details instead.`);
  } else if (q && q.type === "bpay") {
    const b = db.get("SELECT * FROM bpay_billers WHERE code = ?", [q.biller]);
    if (!b) add("QR code BPAY biller isn't registered", "warn", `The QR code uses BPAY biller code ${q.biller}, which isn't in the BPAY directory.`);
    else add("QR code BPAY biller is registered", "pass", `BPAY biller code ${q.biller} belongs to ${b.name}.`);
  } else if (q && q.type === "text") add("QR code found", "info", `The QR code contains: "${q.raw.slice(0, 80)}". It isn't a payment code we recognise.`);
  return C;
}

module.exports = { decodeQr, parseQr, paymentCodeChecks, payidRow, normPayid };
