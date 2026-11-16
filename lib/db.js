// The bank's database (SQLite, stored in data/bank.sqlite).
// Uses sql.js (SQLite compiled to WebAssembly), so there's nothing to install or compile on Windows/Mac.
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const FILE = path.join(__dirname, "..", "data", "bank.sqlite");
let db = null;

const DAY = 86400000;
const daysAgo = d => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS businesses (          -- mirror of the Australian Business Register (ABR)
  abn TEXT PRIMARY KEY, entity_name TEXT NOT NULL, trading_names TEXT, entity_type TEXT,
  abn_status TEXT, abn_registered TEXT, gst_registered TEXT, acn TEXT,
  address TEXT, state TEXT, postcode TEXT, phone TEXT, website TEXT, email_domain TEXT, industry TEXT
);
CREATE TABLE IF NOT EXISTS bank_accounts (       -- accounts known to the bank network (CoP + KYC + risk signals)
  bsb TEXT NOT NULL, account_number TEXT NOT NULL, bank_name TEXT, account_name TEXT, account_type TEXT,
  linked_abn TEXT, kyc_status TEXT, kyc_verified_on TEXT, opened_on TEXT,
  unique_senders_7d INTEGER DEFAULT 0, outflow_24h_pct INTEGER DEFAULT 0,
  PRIMARY KEY (bsb, account_number)
);
CREATE TABLE IF NOT EXISTS scam_reports (        -- confirmed reports: bank fraud team, AFCX, Scamwatch
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, value TEXT, source TEXT, reported_on TEXT, description TEXT
);
CREATE TABLE IF NOT EXISTS customer_accounts (   -- the business customer's own Westpac accounts
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, bsb TEXT, account_number TEXT, balance REAL
);
CREATE TABLE IF NOT EXISTS saved_payees (        -- businesses this customer has saved / paid before
  id INTEGER PRIMARY KEY AUTOINCREMENT, nickname TEXT, abn TEXT, account_name TEXT, bsb TEXT, account_number TEXT, added_on TEXT
);
CREATE TABLE IF NOT EXISTS transfers (           -- this customer's outgoing payments (history + velocity checks)
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, payee TEXT, abn TEXT, bsb TEXT, account_number TEXT,
  amount REAL, reference TEXT, status TEXT, check_level TEXT
);
CREATE TABLE IF NOT EXISTS invoices (            -- invoices received by the business (bills inbox)
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT, business_name TEXT, abn TEXT, amount_due REAL,
  due_date TEXT, received_at TEXT, received_from TEXT, image TEXT, status TEXT, scenario TEXT, fields TEXT
);
CREATE TABLE IF NOT EXISTS fraud_cases (         -- cases raised from the app (reports + fraud-team callbacks)
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, kind TEXT, payee TEXT, abn TEXT, bsb TEXT, account_number TEXT,
  amount REAL, level TEXT, score INTEGER, findings TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS verifications (       -- audit log of every Invoice Check
  id INTEGER PRIMARY KEY AUTOINCREMENT, checked_at TEXT, business_name TEXT, abn TEXT, bsb TEXT, account_number TEXT,
  amount REAL, level TEXT, score INTEGER, summary TEXT
);`;

function seed() {
  const B = (abn, entity, trading, type, status, regDays, gstDays, address, state, postcode, phone, domain, industry, acn = "") =>
    run(`INSERT INTO businesses VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [abn, entity, trading, type, status, daysAgo(regDays), gstDays == null ? null : daysAgo(gstDays), acn, address, state, postcode, phone, "www." + domain, domain, industry]);
  const PTY = "Australian Private Company", SOLE = "Individual/Sole Trader";
  B("91526018159", "Gold Coast Motors Pty Ltd", "Gold Coast Motors", PTY, "Active", 6467, 6467, "88 Nerang Street, Southport", "QLD", "4215", "(07) 5550 1820", "goldcoastmotors.com.au", "Motor vehicle retailing", "526018159");
  B("52083016613", "Coomera Solar Installations Pty Ltd", "Coomera Solar", PTY, "Active", 3600, 3600, "3/12 Foxwell Road, Coomera", "QLD", "4209", "(07) 5550 7734", "coomerasolar.com.au", "Electrical services", "083016613");
  B("79104332181", "Burleigh Conveyancing Pty Ltd", "Burleigh Conveyancing", PTY, "Active", 5100, 5100, "21 James Street, Burleigh Heads", "QLD", "4220", "(07) 5550 4410", "burleighconveyancing.com.au", "Legal services (conveyancing)", "104332181");
  B("85960013389", "Surfers Paradise Plumbing Pty Ltd", "SP Plumbing", PTY, "Active", 4300, 4300, "5 Ferny Avenue, Surfers Paradise", "QLD", "4217", "(07) 5550 2288", "spplumbing.com.au", "Plumbing services", "960013389");
  B("61083863794", "Broadbeach Dental Group Pty Ltd", "Broadbeach Dental", PTY, "Active", 5500, 5500, "2 Oracle Boulevard, Broadbeach", "QLD", "4218", "(07) 5550 9001", "broadbeachdental.com.au", "Dental services", "083863794");
  B("50026542351", "Nerang Building Supplies Pty Ltd", "Nerang Building Supplies", PTY, "Active", 7600, 7600, "140 Nerang-Broadbeach Road, Nerang", "QLD", "4211", "(07) 5550 3130", "nerangbuilding.com.au", "Building supplies wholesaling", "026542351");
  B("94161559407", "PATTERSON, SAM", "Helensvale Electrical Services", SOLE, "Active", 2500, 2500, "Helensvale", "QLD", "4212", "0412 555 260", "helensvaleelectrical.com.au", "Electrical services");
  B("22816184959", "Robina Roofing Pty Ltd", "Robina Roofing", PTY, "Active", 3200, 3200, "9 Investigator Drive, Robina", "QLD", "4226", "(07) 5550 6602", "robinaroofing.com.au", "Roofing services", "816184959");
  B("92310341316", "Southport Furniture Co Pty Ltd", "Southport Furniture Co", PTY, "Active", 4700, 4700, "33 Scarborough Street, Southport", "QLD", "4215", "(07) 5550 1177", "southportfurniture.com.au", "Furniture retailing", "310341316");
  B("14475255341", "Pacific Pines Pool Builders Pty Ltd", "PP Pools", PTY, "Active", 2900, 2900, "Pacific Pines", "QLD", "4211", "(07) 5550 8820", "pppools.com.au", "Swimming pool construction", "475255341");
  B("90928327648", "Hope Island Marine Sales Pty Ltd", "Hope Island Marine", PTY, "Active", 5900, 5900, "10 Santa Barbara Road, Hope Island", "QLD", "4212", "(07) 5550 4499", "hopeislandmarine.com.au", "Boat retailing", "928327648");
  B("63350305641", "Varsity Lakes Accounting Pty Ltd", "VL Accounting", PTY, "Active", 4000, 4000, "Varsity Lakes", "QLD", "4227", "(07) 5550 7310", "vlaccounting.com.au", "Accounting services", "350305641");
  B("58395376724", "REID, TAYLOR", "Mermaid Beach Kitchens", SOLE, "Active", 75, null, "Mermaid Beach", "QLD", "4218", "0412 555 731", "mermaidbeachkitchens.com.au", "Cabinet making");
  B("55238849696", "Labrador Car Rentals Pty Ltd", "Labrador Car Rentals", PTY, "Cancelled", 4200, 4200, "Labrador", "QLD", "4215", "(07) 5550 2045", "labradorcarrentals.com.au", "Car rental", "238849696");
  B("16532871012", "Tweed Coast Landscaping Pty Ltd", "Tweed Coast Landscaping", PTY, "Active", 3900, 3900, "Tweed Heads", "NSW", "2485", "(07) 5550 6655", "tweedlandscaping.com.au", "Landscaping services", "532871012");
  B("45627048281", "Coomera Coffee Roasters Pty Ltd", "Coomera Coffee Roasters", PTY, "Active", 2600, 2600, "7 Commercial Drive, Coomera", "QLD", "4209", "(07) 5550 4120", "coomeracoffee.com.au", "Coffee roasting and café", "627048281");
  B("64269166978", "Ormeau Tiling & Stone Pty Ltd", "Ormeau Tiling", PTY, "Active", 2100, 2100, "Ormeau", "QLD", "4208", "(07) 5550 3398", "ormeautiling.com.au", "Tiling services", "269166978");

  const A = (bsb, acc, bank, name, type, abn, kyc, kycDays, openDays, senders, outPct) =>
    run(`INSERT INTO bank_accounts VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [bsb, acc, bank, name, type, abn, kyc, kycDays == null ? null : daysAgo(kycDays), daysAgo(openDays), senders, outPct]);
  const V = "Verified";
  A("034002", "44712093", "Westpac", "GOLD COAST MOTORS PTY LTD", "Business", "91526018159", V, 6460, 6460, 6, 12);
  A("064450", "11223344", "Commonwealth Bank", "COOMERA SOLAR INSTALLATIONS PTY LTD", "Business", "52083016613", V, 3590, 3590, 7, 15);
  A("484799", "33017745", "Suncorp Bank", "COOMERA SOLAR INSTALLATIONS PTY LTD", "Business", "52083016613", V, 37, 38, 5, 8);
  A("032585", "51904412", "Westpac", "BURLEIGH CONVEYANCING PTY LTD TRUST ACCOUNT", "Business (trust)", "79104332181", V, 5090, 5090, 9, 40);
  A("014211", "60458821", "ANZ", "SURFERS PARADISE PLUMBING PTY LTD", "Business", "85960013389", V, 4290, 4290, 11, 10);
  A("082140", "39950173", "NAB", "BROADBEACH DENTAL GROUP PTY LTD", "Business", "61083863794", V, 5490, 5490, 40, 5);
  A("034118", "22906617", "Westpac", "NERANG BUILDING SUPPLIES PTY LTD", "Business", "50026542351", V, 7590, 7590, 25, 20);
  A("124001", "88123409", "Bank of Queensland", "S PATTERSON", "Business", "94161559407", V, 2490, 2490, 4, 18);
  A("064113", "10774532", "Commonwealth Bank", "ROBINA ROOFING PTY LTD", "Business", "22816184959", V, 3190, 3190, 8, 12);
  A("034209", "70331985", "Westpac", "SOUTHPORT FURNITURE CO PTY LTD", "Business", "92310341316", V, 4690, 4690, 30, 9);
  A("014590", "45521876", "ANZ", "PACIFIC PINES POOL BUILDERS PTY LTD", "Business", "14475255341", V, 2890, 2890, 3, 14);
  A("082207", "61338420", "NAB", "HOPE ISLAND MARINE SALES PTY LTD", "Business", "90928327648", V, 5890, 5890, 5, 11);
  A("034310", "90215546", "Westpac", "VARSITY LAKES ACCOUNTING PTY LTD", "Business", "63350305641", V, 3990, 3990, 22, 6);
  A("064998", "30418827", "Commonwealth Bank", "T REID", "Business", "58395376724", V, 70, 72, 2, 20);
  A("032011", "77100293", "Westpac", "TWEED COAST LANDSCAPING PTY LTD", "Business", "16532871012", V, 3890, 3890, 6, 13);
  A("484120", "52098813", "Suncorp Bank", "ORMEAU TILING & STONE PTY LTD", "Business", "64269166978", V, 2090, 2090, 4, 16);
  A("034111", "66201984", "Westpac", "COOMERA COFFEE ROASTERS PTY LTD", "Business", "45627048281", V, 2590, 2590, 120, 35);
  // Suspicious personal accounts
  A("062914", "10885532", "Commonwealth Bank", "K LEE", "Personal", null, "Verified (individual)", 9, 9, 14, 91);
  A("732110", "55219087", "Westpac", "R WILSON", "Personal", null, "Verified (individual)", 21, 21, 8, 74);
  A("033501", "22901144", "Westpac", "M NGUYEN", "Personal", null, "Pending", null, 6, 11, 88);

  const R = (type, value, source, days, desc) => run(`INSERT INTO scam_reports (type,value,source,reported_on,description) VALUES (?,?,?,?,?)`, [type, value, source, daysAgo(days), desc]);
  R("account", "73211055219087", "AFCX (shared bank intelligence)", 4, "Receiving account in 3 reported car-sale scams");
  R("email_domain", "goldcoastmotors-au.com", "Westpac Fraud team", 2, "Look-alike domain sending invoice-redirection emails impersonating Gold Coast Motors");
  R("phone", "0412555019", "Scamwatch", 6, "Number used in fake vehicle-sale listings");
  R("account", "03350122901144", "Westpac Fraud team", 1, "Mule account linked to a 'safe account' impersonation scam");

  // The business customer using the app
  run(`INSERT INTO customer_accounts (name,bsb,account_number,balance) VALUES (?,?,?,?)`, ["Business One", "034111", "66201984", 84250.00]);
  run(`INSERT INTO customer_accounts (name,bsb,account_number,balance) VALUES (?,?,?,?)`, ["Business Cash Reserve", "034111", "66202207", 40000.00]);

  const SP = (nick, abn, name, bsb, acc, days) => run(`INSERT INTO saved_payees (nickname,abn,account_name,bsb,account_number,added_on) VALUES (?,?,?,?,?,?)`, [nick, abn, name, bsb, acc, daysAgo(days)]);
  SP("Gold Coast Motors", "91526018159", "Gold Coast Motors Pty Ltd", "034002", "44712093", 20);
  SP("Coomera Solar", "52083016613", "Coomera Solar Installations Pty Ltd", "064450", "11223344", 70);
  SP("VL Accounting", "63350305641", "Varsity Lakes Accounting Pty Ltd", "034310", "90215546", 400);
  SP("Nerang Building Supplies", "50026542351", "Nerang Building Supplies Pty Ltd", "034118", "22906617", 90);
  SP("SP Plumbing", "85960013389", "Surfers Paradise Plumbing Pty Ltd", "014211", "60458821", 300);
  SP("Southport Furniture Co", "92310341316", "Southport Furniture Co Pty Ltd", "034209", "70331985", 150);

  const T = (days, payee, abn, bsb, acc, amount, ref) => run(`INSERT INTO transfers (created_at,payee,abn,bsb,account_number,amount,reference,status,check_level) VALUES (?,?,?,?,?,?,?,?,?)`,
    [new Date(Date.now() - days * DAY).toISOString(), payee, abn, bsb, acc, amount, ref, "Sent", amount >= 5000 ? "green" : "not needed"]);
  T(14, "Gold Coast Motors Pty Ltd", "91526018159", "034002", "44712093", 1000, "Deposit - delivery van");
  T(30, "Nerang Building Supplies Pty Ltd", "50026542351", "034118", "22906617", 2300, "NBS-1044");
  T(45, "Southport Furniture Co Pty Ltd", "92310341316", "034209", "70331985", 3800, "Café tables SF-881");
  T(59, "Coomera Solar Installations Pty Ltd", "52083016613", "064450", "11223344", 1500, "Solar deposit");
  T(62, "Surfers Paradise Plumbing Pty Ltd", "85960013389", "014211", "60458821", 640, "SPP-7514");
  T(120, "Varsity Lakes Accounting Pty Ltd", "63350305641", "034310", "90215546", 1650, "VLA-2180");

  // Bills inbox (dummy invoices with images in public/samples)
  const invs = require("../data/invoices.json");
  for (const i of invs) {
    const f = i.fields;
    run(`INSERT INTO invoices (invoice_number,business_name,abn,amount_due,due_date,received_at,received_from,image,status,scenario,fields) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [f.invoice_number, f.business_name, f.abn.replace(/\D/g, ""), f.amount_due, daysAgo(-7), new Date(Date.now() - i.received_hours_ago * 3600000).toISOString(), i.received_from, i.file, "Unpaid", i.scenario, JSON.stringify(f)]);
  }
}

/* ---------- tiny query helpers ---------- */
function run(sql, params = []) { db.run(sql, params); }
function all(sql, params = []) {
  const st = db.prepare(sql); st.bind(params);
  const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free(); return rows;
}
const get = (sql, params = []) => all(sql, params)[0] || null;
function save() { fs.writeFileSync(FILE, Buffer.from(db.export())); }

async function init({ reset = false } = {}) {
  const SQL = await initSqlJs();
  if (!reset && fs.existsSync(FILE)) db = new SQL.Database(fs.readFileSync(FILE));
  else {
    db = new SQL.Database(); db.run(SCHEMA); seed(); save();
    console.log("  Bank database created: data/bank.sqlite");
  }
  db.run(SCHEMA);
  return db;
}

module.exports = { init, run, all, get, save, daysAgo, DAY };

// `npm run seed` -> rebuild the database from scratch
if (require.main === module) init({ reset: true }).then(() => console.log("Database reset with sample data."));
