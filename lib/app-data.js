// Extra data for the phone banking app (public/index.html): the demo customer's payees, PayIDs, BPAY billers,
// customer scam reports and identity (KYC) profile. Added to the same bank database (data/bank.sqlite)
// next to the invoice-check sample data. Rows are only added if they're missing, so nothing is overwritten.
const db = require("./db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payids (               -- NPP PayID register: PayID -> account
  payid TEXT PRIMARY KEY, holder_name TEXT, payid_type TEXT, account_key TEXT
);
CREATE TABLE IF NOT EXISTS bpay_billers (         -- BPAY biller directory
  code TEXT PRIMARY KEY, name TEXT
);
CREATE TABLE IF NOT EXISTS customer_reports (     -- "Report as scam" from app customers (not yet confirmed)
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, customer_id INTEGER, reported_at TEXT, note TEXT
);`;

// The app signs every browser in as this customer (identity verified, so they can report scams)
const CUSTOMER = {
  id: 1, firstName: "Alex", lastName: "Chen", customerSince: "2014-03-18",
  kyc: {
    status: "verified", level: "Full", verifiedAt: "2024-02-10", riskRating: "Low",
    documents: [
      { type: "NSW driver licence", number: "•••• 7731", verifiedVia: "Document Verification Service (DVS)", verifiedAt: "2024-02-10", expires: "2029-09-30", status: "verified" },
      { type: "Australian passport", number: "PA••••312", verifiedVia: "Document Verification Service (DVS)", verifiedAt: "2014-03-18", expires: "2031-05-21", status: "verified" }
    ],
    checks: [
      { type: "Identity document check (DVS)", result: "pass", checkedAt: "2024-02-10" },
      { type: "Face match to ID photo", result: "pass", checkedAt: "2024-02-10" },
      { type: "Liveness check", result: "pass", checkedAt: "2024-02-10" },
      { type: "Sanctions and PEP screening", result: "clear", checkedAt: "2026-11-01" }
    ]
  }
};

function ensure() {
  SCHEMA.split(";").filter(q => q.trim()).forEach(q => db.run(q));
  const d = db.daysAgo;
  const B = (abn, entity, trading, status, regDays, gstDays, address, state, postcode, phone, domain, industry) =>
    db.run(`INSERT OR IGNORE INTO businesses (abn,entity_name,trading_names,entity_type,abn_status,abn_registered,gst_registered,address,state,postcode,phone,website,email_domain,industry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [abn, entity, trading, "Australian Private Company", status, d(regDays), gstDays == null ? null : d(gstDays), address, state, postcode, phone, "www." + domain, domain, industry]);
  B("51824753524", "Sydney City Motors Pty Ltd", "Sydney City Motors", "Active", 6460, 6460, "200 Parramatta Road, Camperdown", "NSW", "2050", "(02) 9550 2210", "sydneycitymotors.com.au", "Motor vehicle retailing");
  B("33051775524", "Bayside Property Group Pty Ltd", "Bayside Property Rentals", "Active", 5260, 5260, "12 Bay Street, Brighton-Le-Sands", "NSW", "2216", "(02) 9550 7710", "baysiderentals.com.au", "Real estate services");
  B("11458226012", "Quick Fix Plumbing Pty Ltd", "Quick Fix Plumbing", "Active", 138, null, "Wollongong", "NSW", "2500", "0412 555 870", "quickfixplumbing.com.au", "Plumbing services");
  B("73410091807", "Harbour Builders Pty Ltd", "Harbour Builders", "Cancelled", 4300, null, "Port Kembla", "NSW", "2505", "(02) 4200 3300", "harbourbuilders.com.au", "Building construction");
  B("62301987403", "Bright Spark Electrical Pty Ltd", "Bright Spark Electrical", "Active", 3150, 3150, "14 Harbour Street, Wollongong", "NSW", "2500", "(02) 4200 1188", "brightspark.com.au", "Electrical services");
  B("47556120322", "Metro Office Supplies Pty Ltd", "Metro Office Supplies", "Active", 5550, 5550, "40 George Street, Sydney", "NSW", "2000", "(02) 9550 4040", "metrooffice.com.au", "Office supplies retailing");

  const A = (bsb, acc, bank, name, type, abn, kyc, openDays, senders, outPct) =>
    db.run(`INSERT OR IGNORE INTO bank_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [bsb, acc, bank, name, type, abn, kyc, kyc ? d(openDays) : null, d(openDays), senders, outPct]);
  const V = "Verified", VI = "Verified (individual)";
  A("062000", "12345678", "Commonwealth Bank", "SAM LEE", "Personal", null, VI, 2400, 2, 10);
  A("082401", "99887766", "NAB", "JORDAN SMITH", "Personal", null, VI, 1800, 1, 8);
  A("032555", "98765432", "Westpac", "DANIEL PRICE", "Personal", null, VI, 3100, 2, 12);
  A("033001", "22334455", "Westpac", "BAYSIDE PROPERTY RENTALS", "Business", "33051775524", V, 4200, 18, 10);
  A("063010", "44332211", "Commonwealth Bank", "BRIGHT SPARK ELECTRICAL", "Business", "62301987403", V, 2900, 9, 14);
  A("083120", "55667788", "NAB", "METRO OFFICE SUPPLIES", "Business", "47556120322", V, 5000, 25, 9);
  A("034002", "11223344", "Westpac", "SYDNEY CITY MOTORS", "Business", "51824753524", V, 6000, 7, 12);
  A("036111", "44556677", "Westpac", "QUICK FIX PLUMBING", "Business", "11458226012", V, 120, 4, 15);
  A("037001", "88889999", "Westpac", "HARBOUR BUILDERS", "Business", "73410091807", V, 3500, 0, 0);
  A("082555", "77881122", "NAB", "ACME DESIGN LLC", "Business", null, V, 900, 3, 10);
  A("013999", "55551212", "ANZ", "K NGUYEN", "Personal", null, VI, 21, 14, 92);
  A("032888", "77776666", "Westpac", "M ROSSI", "Personal", null, "Pending", 14, 12, 88);

  const R = (type, value, source, days, desc) => {
    if (!db.get("SELECT 1 FROM scam_reports WHERE type = ? AND value = ?", [type, value]))
      db.run(`INSERT INTO scam_reports (type,value,source,reported_on,description) VALUES (?,?,?,?,?)`, [type, value, source, d(days), desc]);
  };
  R("account", "01399955551212", "Westpac Fraud team + AFCX", 3, "Receiving account in 7 reported invoice-redirection scams");
  R("account", "03288877776666", "Westpac Fraud team", 5, "Account behind the 'Tax Resolution Services' ATO impersonation scam (12 reports)");
  R("email_domain", "brightspark-electrical.com.au", "Westpac Fraud team", 2, "Look-alike domain sending fake 'new bank details' emails impersonating Bright Spark Electrical");

  const P = (payid, holder, type, key) => db.run(`INSERT OR IGNORE INTO payids VALUES (?,?,?,?)`, [payid, holder, type, key]);
  P("0412345678", "Sam Lee", "personal", "06200012345678");
  P("jordan@email.com", "Jordan Smith", "personal", "08240199887766");
  P("62301987403", "Bright Spark Electrical", "business", "06301044332211");
  P("accounts@sydneycitymotors.com.au", "Sydney City Motors", "business", "03400211223344");
  P("0499000111", "Tax Resolution Services", "personal", "03288877776666");
  // PayIDs on the test invoices (test-invoices/T16, T17)
  P("22816184959", "Robina Roofing Pty Ltd", "business", "06411310774532");
  P("accounts@robinaroofing.com.au", "Robina Roofing Pty Ltd", "business", "06411310774532");
  P("64269166978", "Ormeau Tiling & Stone Pty Ltd", "business", "48412052098813");
  P("robinaroofing.payments@gmail.com", "K LEE", "personal", "06291410885532");

  for (const [code, name] of [["12345", "Harbour Energy"], ["23456", "CityNet Internet"], ["34567", "Metro Water"]])
    db.run(`INSERT OR IGNORE INTO bpay_billers VALUES (?,?)`, [code, name]);
  db.save();
}

module.exports = { ensure, CUSTOMER };
