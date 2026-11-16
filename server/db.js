'use strict';
/*
 * The Scam Protect database (SQLite, built into Node.js 22.13 and newer - no install needed).
 * File: data/scamprotect.db (created and filled with demo data on first start).
 *
 * Tables
 *   abn_register      Australian Business Register records (ABN Lookup)
 *   bank_accounts     Accounts at Westpac and other banks, for the name check (Confirmation of Payee)
 *   payids            PayIDs and the account each one points to
 *   scam_intel        Confirmed scam accounts (fraud team and other banks)
 *   scam_reports      Reports made by customers (one per customer per account)
 *   bpay_billers      BPAY biller directory
 *   overseas_register UK Companies House and NZ business numbers
 *   customers         Customer profiles
 *   kyc_documents     Identity documents (KYC)
 *   kyc_checks        Identity and screening checks (KYC)
 *   sessions          Signed-in browser sessions
 *   check_log         Audit log of every scam check (no invoice files or bank details are stored)
 *
 * Reset to the demo data:  npm run reset-db
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const seed = require('./seed');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'scamprotect.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS abn_register (
  abn TEXT PRIMARY KEY, name TEXT NOT NULL, entity_name TEXT, status TEXT NOT NULL CHECK (status IN ('Active','Cancelled')),
  active_from TEXT NOT NULL, cancelled_from TEXT, gst INTEGER NOT NULL DEFAULT 0, business_names TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS bank_accounts (
  account_key TEXT PRIMARY KEY, bsb TEXT NOT NULL, account_number TEXT NOT NULL, holder_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('personal','business')), bank TEXT NOT NULL, opened_on TEXT NOT NULL,
  abn TEXT REFERENCES abn_register(abn));
CREATE TABLE IF NOT EXISTS payids (
  payid TEXT PRIMARY KEY, holder_name TEXT NOT NULL, payid_type TEXT NOT NULL, account_key TEXT NOT NULL REFERENCES bank_accounts(account_key));
CREATE TABLE IF NOT EXISTS scam_intel (
  account_key TEXT PRIMARY KEY, confirmed_reports INTEGER NOT NULL DEFAULT 0, confirmed INTEGER NOT NULL DEFAULT 0, source TEXT);
CREATE TABLE IF NOT EXISTS scam_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target_key TEXT NOT NULL, customer_id INTEGER NOT NULL REFERENCES customers(id),
  reported_at TEXT NOT NULL, note TEXT, UNIQUE (target_key, customer_id));
CREATE TABLE IF NOT EXISTS bpay_billers (code TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS overseas_register (
  registry TEXT NOT NULL, number TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (registry, number));
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, dob TEXT, email TEXT, mobile TEXT, address TEXT,
  customer_since TEXT, kyc_status TEXT NOT NULL CHECK (kyc_status IN ('verified','pending','failed')), kyc_level TEXT,
  kyc_verified_at TEXT, risk_rating TEXT);
CREATE TABLE IF NOT EXISTS kyc_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id), doc_type TEXT NOT NULL,
  number_masked TEXT NOT NULL, verified_via TEXT, verified_at TEXT, expires TEXT, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kyc_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id), check_type TEXT NOT NULL,
  result TEXT NOT NULL, checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), created_at TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS check_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, check_type TEXT NOT NULL, risk_score INTEGER, level TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_reports_target ON scam_reports(target_key);
CREATE INDEX IF NOT EXISTS idx_reports_customer ON scam_reports(customer_id, reported_at);
`;

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const empty = db.prepare('SELECT COUNT(*) AS n FROM abn_register').get().n === 0;
  if (empty) load(db);
  return db;
}

function load(db) {
  db.exec('BEGIN');
  try {
    const abn = db.prepare('INSERT INTO abn_register VALUES (?,?,?,?,?,?,?,?)');
    seed.abnRegister.forEach(r => abn.run(r.abn, r.name, r.entityName, r.status, r.activeFrom, r.cancelledFrom, r.gst, JSON.stringify(r.businessNames)));
    const acct = db.prepare('INSERT INTO bank_accounts VALUES (?,?,?,?,?,?,?,?)');
    seed.bankAccounts.forEach(r => acct.run(r.bsb + r.account, r.bsb, r.account, r.holder, r.type, r.bank, r.opened, r.abn || null));
    const pid = db.prepare('INSERT INTO payids VALUES (?,?,?,?)');
    seed.payids.forEach(r => pid.run(r.payid, r.holder, r.type, r.accountKey));
    const intel = db.prepare('INSERT INTO scam_intel VALUES (?,?,?,?)');
    seed.scamIntel.forEach(r => intel.run(r.accountKey, r.confirmedReports, r.confirmed, r.source));
    const biller = db.prepare('INSERT INTO bpay_billers VALUES (?,?)');
    seed.billers.forEach(r => biller.run(r.code, r.name));
    const ovs = db.prepare('INSERT INTO overseas_register VALUES (?,?,?,?)');
    seed.overseas.forEach(r => ovs.run(r.registry, r.number, r.name, r.status));
    const cust = db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    seed.customers.forEach(c => cust.run(c.id, c.firstName, c.lastName, c.dob, c.email, c.mobile, c.address, c.customerSince, c.kycStatus, c.kycLevel, c.kycVerifiedAt, c.riskRating));
    const doc = db.prepare('INSERT INTO kyc_documents (customer_id, doc_type, number_masked, verified_via, verified_at, expires, status) VALUES (?,?,?,?,?,?,?)');
    seed.kycDocuments.forEach(d => doc.run(d.customerId, d.docType, d.numberMasked, d.verifiedVia, d.verifiedAt, d.expires, d.status));
    const chk = db.prepare('INSERT INTO kyc_checks (customer_id, check_type, result, checked_at) VALUES (?,?,?,?)');
    seed.kycChecks.forEach(k => chk.run(k.customerId, k.checkType, k.result, k.checkedAt));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------------------------------------------------------------- Reset (npm run reset-db)
if (require.main === module && process.argv.includes('--reset')) {
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) { try { fs.unlinkSync(f); } catch (e) { /* not there */ } }
  open(DB_FILE).close();
  console.log('Database reset to the demo data:', DB_FILE);
  process.exit(0);
}

const db = open(DB_FILE);
const now = () => new Date().toISOString();

// All queries use bound parameters (no SQL is built from user input)
const st = {
  abn: db.prepare('SELECT * FROM abn_register WHERE abn = ?'),
  account: db.prepare('SELECT * FROM bank_accounts WHERE account_key = ?'),
  payid: db.prepare('SELECT * FROM payids WHERE payid = ?'),
  intel: db.prepare('SELECT * FROM scam_intel WHERE account_key = ?'),
  reportCount: db.prepare('SELECT COUNT(*) AS n FROM scam_reports r JOIN customers c ON c.id = r.customer_id WHERE r.target_key = ? AND c.kyc_status = \'verified\''),
  reportExists: db.prepare('SELECT 1 AS x FROM scam_reports WHERE target_key = ? AND customer_id = ?'),
  reportsSince: db.prepare('SELECT COUNT(*) AS n FROM scam_reports WHERE customer_id = ? AND reported_at > ?'),
  addReport: db.prepare('INSERT INTO scam_reports (target_key, customer_id, reported_at, note) VALUES (?,?,?,?)'),
  biller: db.prepare('SELECT * FROM bpay_billers WHERE code = ?'),
  overseas: db.prepare('SELECT * FROM overseas_register WHERE registry = ? AND number = ?'),
  customer: db.prepare('SELECT * FROM customers WHERE id = ?'),
  kycDocs: db.prepare('SELECT doc_type, number_masked, verified_via, verified_at, expires, status FROM kyc_documents WHERE customer_id = ? ORDER BY id'),
  kycChecks: db.prepare('SELECT check_type, result, checked_at FROM kyc_checks WHERE customer_id = ? ORDER BY id'),
  addSession: db.prepare('INSERT INTO sessions VALUES (?,?,?,?)'),
  session: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?'),
  pruneSessions: db.prepare('DELETE FROM sessions WHERE last_seen < ?'),
  log: db.prepare('INSERT INTO check_log (customer_id, check_type, risk_score, level, created_at) VALUES (?,?,?,?,?)'),
};

module.exports = {
  DB_FILE,
  abn: abn => st.abn.get(abn),
  account: key => st.account.get(key),
  payid: id => st.payid.get(id),
  intel: key => st.intel.get(key),
  verifiedReportCount: key => st.reportCount.get(key).n,
  hasReported: (key, customerId) => !!st.reportExists.get(key, customerId),
  reportsSince: (customerId, iso) => st.reportsSince.get(customerId, iso).n,
  addReport: (key, customerId, note) => st.addReport.run(key, customerId, now(), note || null),
  biller: code => st.biller.get(code),
  overseas: (registry, number) => st.overseas.get(registry, number),
  customer: id => st.customer.get(id),
  kycDocuments: id => st.kycDocs.all(id),
  kycChecks: id => st.kycChecks.all(id),
  createSession: (sid, customerId) => st.addSession.run(sid, customerId, now(), now()),
  session: sid => st.session.get(sid),
  touchSession: sid => st.touchSession.run(now(), sid),
  pruneSessions: () => st.pruneSessions.run(new Date(Date.now() - 7 * 86400000).toISOString()),
  logCheck: (customerId, type, score, level) => st.log.run(customerId || null, type, score == null ? null : score, level || null, now()),
};
