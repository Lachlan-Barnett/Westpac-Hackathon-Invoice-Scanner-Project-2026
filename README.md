# Invoice Checker V2

V2 combines the two versions of the project:

- **Frontend:** the phone banking app from the `UI-Version` branch (`public/index.html` + `public/apis.js`): Scam Protect, the invoice scanner (Upload / Email / Photo), name checks, the Scam Risk Score, the big payment plan, the message checker and scan history.
- **Backend:** this Invoice Check server: Gemini reads invoices, the 9 checks run against the bank database (`data/bank.sqlite`), and you can use the staff console and settings.

| Page | What it is |
|---|---|
| http://localhost:3000 | The phone app (UI-Version design, Invoice Check backend) |
| http://localhost:3000/classic.html | The original Invoice Check business app |
| http://localhost:3000/staff.html | Staff console: browse and edit the bank database, API keys |

Run it the same way as before: `npm install` (once), then `npm start` (or double-click `start.bat`).

**How the parts connect**
- `lib/app-api.js` provides the routes the phone app calls (`/api/health`, `/api/invoice/read`, `/api/invoice/analyze`, `/api/payment/*`, `/api/message/check`, `/api/plan/start`, `/api/intel/report`, `/api/customer/me`, `/api/bpay/:code`). Each one uses the Invoice Check backend:
  - **Reading an invoice** uses Gemini (`lib/gemini.js`). Without a key, it uses the saved details for the demo invoices.
  - **Scanning an invoice** happens in two steps, using the Invoice Check app's AI animations:
    1. **Scan and fill in:** an "AI is reading your invoice" screen with a scan line over the invoice. Then every field is filled in one by one: business, ABN, bank details, amount, reference, invoice number, date, subtotal, GST, total, email and phone.
    2. **Check:** the customer checks the details and taps **Check this invoice**. `lib/checks.js` then checks them against the internal database, the ABN register and KYC records, one check at a time. The result card shows the trust score and the "✨ INVOICE CHECK" summary. An AI risk review is added when Gemini is on.

    Editing a field after the check re-checks straight away.
- **Backend panel** (next to the phone; on small screens, tap the **Backend** button):
  - whether the Gemini key is set, the model, ABN Lookup mode and a **Test Gemini key** button
  - row counts for each database table, with links to browse it or add a business, bank account, scam report or PayID in the staff console
  - a live log of every API call the phone app makes. Tap one to see what was sent and received.
  - **Name check and Scam Risk Score** use the `bank_accounts` and `scam_reports` tables.
- `lib/app-data.js` adds the phone app's demo data to the same database: Sam Lee, Jordan Smith, Bright Spark Electrical, K Nguyen and the other demo accounts, plus the PayIDs, BPAY billers and Alex Chen's identity (KYC) profile. Rows are only added if they're missing, and *Reset to sample data* adds them back.
- "Report as scam" in the phone app saves the report and opens a case in the staff console (`fraud_cases`).
- The phone app keeps its own rule: **inform, never block**. A red result recommends "Don't pay", but the customer can still continue. The classic app still blocks red payments on the server.

**Demo invoices for the phone app:** `public/sample-invoice-genuine.txt` / `-scam.txt` (paste into Email, or drag in), `sample-invoice.png` / `.pdf` (green), `sample-invoice-edited.pdf` (red). The Gold Coast Motors images in `public/samples/` work in the phone app's scanner too.

The UI branch's full feature guide is in `docs/UI-HOW_IT_WORKS.md`. Its server, PDF.js and Tesseract parts aren't used in V2, because Gemini does the reading.

---

# Invoice Check: Westpac Hackathon 2026 prototype

An AI feature inside a Westpac-style banking app. Before a large transfer, the customer scans the invoice. AI reads it, then we verify the ABN, the business register, who really owns the bank account (Confirmation of Payee), payment history, money-mule signals and signs of tampering. The result is 🟢 / 🟡 / 🔴 with a plain-English explanation.

## 1. Run it (5 minutes)

You need **Node.js 18 or newer** (https://nodejs.org, LTS version).

```bash
cd invoice-check
npm install
npm start
```

Open **http://localhost:3000**. It works straight away in demo mode, with no keys needed for the 4 demo invoices.

Windows shortcut: double-click `start.bat`. Mac/Linux: `./start.sh`.

**API keys:** easiest is http://localhost:3000/staff.html#settings, where you paste the keys and click Save (also sets the large-payment threshold). Or edit the `.env` file.

## 2. Add your API keys (where they go)

Keys go in a file called **`.env`** in the project folder. They stay on the server and are never sent to the browser.

1. Copy `.env.example` and rename the copy to `.env`
2. Open `.env` in any text editor and paste your keys after the `=`:

```
GEMINI_API_KEY=AIza...your key...
GEMINI_MODEL=gemini-3.8-flash
ABR_GUID=your-guid-here
```

3. Save, stop the server (Ctrl+C) and run `npm start` again.
4. The terminal and the page's side panel show **AI: Live** when it's working.

### Where to get the keys
| Key | What it does | Get it |
|---|---|---|
| `GEMINI_API_KEY` | Reads any uploaded invoice (vision AI) and writes the explanation | Free: https://aistudio.google.com/apikey → *Create API key* |
| `ABR_GUID` (optional) | **Live** ABN lookups against the real Australian Business Register | Free: https://abr.business.gov.au/Tools/WebServices → register; the GUID is emailed |

If a model name stops working, change `GEMINI_MODEL` (for example to a newer "flash" model listed in AI Studio).

## 3. How the app works (business-to-business)
The customer is a business (**Coomera Coffee Roasters Pty Ltd**) paying its suppliers from the Westpac Business app.

1. **Pay a business** → choose an unpaid **bill** (invoice inbox), a **saved business**, or **Pay a new business**
2. Choose how to add the details: **scan invoice**, **upload invoice** or **enter manually**. As soon as an ABN is entered, the app shows whether it's a saved business, a new business found on the register, or invalid/cancelled
3. **Under the threshold ($5,000 by default)** → straight to *Review & pay*, with no flags
4. **At or over the threshold**, *or* an unusual run of payments → full **Invoice Check**: ABN checksum, business register (live ABR with a GUID), GST registration, KYC link between the bank account and the ABN, saved payee and history, money-mule screening, scam reports, invoice integrity, transfer pattern, and an **AI risk review** (with a Gemini key)
5. 🟢 pay · 🟡 call the business on the registered number, then confirm · 🔴 **blocked on the server** → *Talk to our fraud team* or *Report this transfer* (creates a case in the staff console)

**Transfer pattern rules:** a 3rd payment to the same business within 24h when the total reaches the threshold (a split payment); 6+ payments within an hour; or an unusually high daily total. These apply to small payments too.

## 4. Demo script (bills inbox)
| Bill | Result |
|---|---|
| Varsity Lakes Accounting $1,650 / SP Plumbing $880 | Quick pay, no checks |
| Nerang Building Supplies NBS-1101, 1102, 1103 ($4,950 each) | 1st and 2nd go straight through; **3rd is flagged 🟡 as a split payment** |
| Gold Coast Motors INV-20481 (from goldcoastmotors.com.au) | 🟢 verified |
| Gold Coast Motors INV-20481 (from goldcoastmotors-au.com) | 🔴 account belongs to "K LEE", mule signals, scam-reported look-alike domain |
| Sunshine Auto Traders | 🔴 invalid ABN, reported account, wrong GST |
| Coomera Solar CS-3318 | 🟡 new (KYC-verified) bank account, different from the saved payee |
| Mermaid Beach Kitchens | 🔴 charges GST but isn't GST-registered |

Before each recording, click **Reset to sample data** in the staff console so all bills are unpaid again.

## The bank database
On first start the app creates **`data/bank.sqlite`** (SQLite, no install needed) with:
| Table | What it holds |
|---|---|
| `businesses` | Business register (ABR) mirror: ABN, legal name, trading names, entity type, ABN status, ABN and GST registration dates, address, phone, website/email domain, industry |
| `bank_accounts` | Accounts in the bank network: BSB, account, bank, account name, **linked ABN + KYC status**, opened date, mule signals |
| `scam_reports` | Confirmed reports (fraud team, AFCX, Scamwatch) on accounts, ABNs, email domains, phone numbers |
| `customer_accounts` | The business customer's own accounts and balances |
| `saved_payees` | Businesses the customer has saved |
| `invoices` | Bills inbox: 10 sample invoices with images |
| `transfers` | The customer's payments (history + transfer-pattern checks) |
| `fraud_cases` | Cases raised from the app (fraud-team callbacks and reports) |
| `verifications` | Audit log of every Invoice Check result |

**Staff view:** http://localhost:3000/staff.html lets you browse the tables, search, and **add your own business, account or scam report**. For example, add the business from a real invoice so it verifies green. Run `npm run seed` (or click *Reset to sample data*) to restore the sample data.

### The 9 checks
1. ABN checksum (ATO algorithm)
2. Business register: exists, active (not cancelled), name matches legal or trading name, flags ABNs under 6 months old
3. GST: invoice charges GST but the business isn't GST-registered → red
4. Account owner: Confirmation of Payee + **KYC link between the bank account and the ABN**
5. Payment history: bank details changed since last time?
6. Money-mule screening: account age, unrelated senders, rapid outflow, incomplete KYC
7. Scam reports: account, ABN, email domain or phone matches a confirmed report
8. Invoice integrity: GST maths, totals, look-alike/free email domain, phone differs from register, "bank details changed", urgency, AI-spotted tampering
9. Payment matches the invoice amount and reference

## What's real vs sample data
- **Real logic:** ABN checksum (ATO algorithm), GST maths, look-alike domain detection, name matching, scoring, AI extraction and explanation (with key), live ABN Lookup (with GUID), server-side refusal to pay red-flagged invoices.
- **Sample data** (`data/bank.sqlite`): fictional businesses, accounts, KYC records, scam reports and payment history. In production these come from the live ABR, AP+ Confirmation of Payee, Westpac's KYC and risk systems, and AFCX.

## Project layout
```
server.js           Express API: /api/status, /api/extract, /api/verify, /api/pay
lib/checks.js       The 7 verification checks + verdict + trust score
lib/gemini.js       Gemini vision extraction + AI explanation
lib/abr.js          ABN Lookup (live or sample)
lib/util.js         ABN checksum, name matching, helpers
lib/db.js           Database schema + sample data (npm run seed to reset)
data/bank.sqlite    The bank database (created on first run)
public/staff.html   Staff console to browse/edit the database
data/samples.json   Demo invoice extractions (used when no AI key)
public/index.html   The mobile banking app UI
public/samples/     Demo invoice images
```

## Deploying online (optional)
Push to GitHub (`.env` is git-ignored), then deploy on Render or Railway as a Node app with start command `npm start`. Add `GEMINI_API_KEY` / `ABR_GUID` in the host's **Environment Variables** settings, not in code.
