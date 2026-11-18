// The customer's history with each supplier (the transfers table), used for:
//  - duplicate invoices: this invoice number (or the same amount, very recently) has already been paid
//  - supplier history: is this amount, and how often they're invoicing, normal for this supplier?
// Invoices paid in the phone app are added to the same table (recordPayment), so the history builds up as you use it.
const db = require("./db");
const U = require("./util");

function ensure() {
  const cols = db.all("PRAGMA table_info(transfers)").map(c => c.name);
  if (!cols.includes("invoice_number")) db.run("ALTER TABLE transfers ADD COLUMN invoice_number TEXT");
  db.run(`CREATE TABLE IF NOT EXISTS callbacks (     -- "I called the business" results from the app
    id INTEGER PRIMARY KEY AUTOINCREMENT, called_at TEXT, abn TEXT, business TEXT, phone TEXT, bsb TEXT, account_number TEXT,
    invoice_number TEXT, amount REAL, outcome TEXT)`);
  // Past payments to the demo suppliers, so the history checks have something to compare with
  const T = (days, payee, abn, bsb, acc, amount, inv) => {
    if (db.get("SELECT 1 FROM transfers WHERE abn = ? AND reference = ?", [abn, inv])) return;
    db.run(`INSERT INTO transfers (created_at,payee,abn,bsb,account_number,amount,reference,status,check_level,invoice_number) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [new Date(Date.now() - days * db.DAY).toISOString(), payee, abn, bsb, acc, amount, inv, "Sent", amount >= 5000 ? "green" : "not needed", inv]);
  };
  T(64, "Robina Roofing Pty Ltd", "22816184959", "064113", "10774532", 12450, "RR-5390");
  T(33, "Robina Roofing Pty Ltd", "22816184959", "064113", "10774532", 15980, "RR-5455");
  T(47, "Ormeau Tiling & Stone Pty Ltd", "64269166978", "484120", "52098813", 4800, "OT-2150");
  T(95, "Tweed Coast Landscaping Pty Ltd", "16532871012", "032011", "77100293", 6200, "TCL-0871");
  T(40, "Tweed Coast Landscaping Pty Ltd", "16532871012", "032011", "77100293", 5850, "TCL-0934");
}

const fmtDate = iso => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
const invKey = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sent = abn => abn ? db.all("SELECT * FROM transfers WHERE abn = ? AND status = 'Sent' ORDER BY created_at DESC", [abn]) : [];
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// x: invoice fields. Returns Invoice Check rows.
function historyChecks(x) {
  const abn = U.digits(x.abn), amount = Number(x.amount_due || x.total || 0), inv = invKey(x.invoice_number);
  const hist = sent(abn), C = [];
  const src = "Your payment history";

  // Duplicate: same invoice number paid before, or the same amount to this business in the last 14 days
  const dup = inv && inv.length >= 3 ? hist.find(h => invKey(h.invoice_number) === inv || invKey(h.reference) === inv) : null;
  const recentSame = !dup && amount > 0 ? hist.find(h => Math.abs(h.amount - amount) < 0.01 && Date.now() - new Date(h.created_at) < 14 * db.DAY) : null;
  if (dup) C.push({ label: "Checking for duplicates", title: "You've already paid this invoice", status: "warn", source: src,
    detail: `You paid invoice ${x.invoice_number} to ${dup.payee} on ${fmtDate(dup.created_at)} (${U.money(dup.amount)}). Paying it again would pay it twice. Scammers also resend old invoices with new bank details.` });
  else if (recentSame) C.push({ label: "Checking for duplicates", title: "Same amount paid very recently", status: "warn", source: src,
    detail: `You paid ${recentSame.payee} ${U.money(recentSame.amount)} on ${fmtDate(recentSame.created_at)} (${recentSame.reference || "no reference"}). Check this isn't the same bill again.` });
  else if (abn) C.push({ label: "Checking for duplicates", title: "Not paid before", status: "pass", source: src,
    detail: inv ? `You haven't paid invoice ${x.invoice_number} before.` : "You haven't paid this amount to this business recently." });

  // Supplier history: needs at least 2 past payments to say what's normal
  if (hist.length >= 2 && amount > 0) {
    const amounts = hist.map(h => h.amount), med = median(amounts), hi = Math.max(...amounts), lo = Math.min(...amounts);
    const days = hist.map(h => new Date(h.created_at).getTime());
    const gaps = days.slice(0, -1).map((d, i) => (d - days[i + 1]) / db.DAY), usualGap = gaps.length ? median(gaps) : null;
    const last30 = hist.filter(h => Date.now() - new Date(h.created_at) < 30 * db.DAY).length;
    const range = lo === hi ? U.money(lo) : `${U.money(lo)} to ${U.money(hi)}`;
    if (amount > med * 3 && amount - hi > 1000)
      C.push({ label: "Comparing with past invoices", title: "Much more than this business usually charges", status: "warn", source: src,
        detail: `${U.money(amount)} is ${Math.round(amount / med)} times what you usually pay ${hist[0].payee} (${hist.length} past payments, ${range}). Check the amount with the business.` });
    else if (usualGap && usualGap >= 20 && last30 >= 2)
      C.push({ label: "Comparing with past invoices", title: "More invoices than usual from this business", status: "warn", source: src,
        detail: `This would be payment number ${last30 + 1} to ${hist[0].payee} in 30 days, but they usually invoice about every ${Math.round(usualGap)} days. Check this invoice is expected.` });
    else
      C.push({ label: "Comparing with past invoices", title: "In line with past invoices", status: "pass", source: src,
        detail: `You've paid ${hist[0].payee} ${hist.length} times before (${range}, last on ${fmtDate(hist[0].created_at)}). This amount and timing are normal for them.` });
  }
  return C;
}

// The result of calling the business on its registered number, if the customer has done it for these details
function lastCallback(x) {
  return db.get("SELECT * FROM callbacks WHERE abn = ? AND bsb = ? AND account_number = ? AND invoice_number = ? ORDER BY id DESC LIMIT 1",
    [U.digits(x.abn), U.digits(x.bsb), U.digits(x.account_number), String(x.invoice_number || "")]);
}

function recordPayment(p) {
  db.run(`INSERT INTO transfers (created_at,payee,abn,bsb,account_number,amount,reference,status,check_level,invoice_number) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [new Date().toISOString(), p.payee, U.digits(p.abn), U.digits(p.bsb), U.digits(p.account), p.amount, p.reference || "", "Sent", p.level || "", p.invoiceNumber || ""]);
  db.save();
}

module.exports = { ensure, historyChecks, lastCallback, recordPayment };
