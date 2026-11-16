# How the Westpac Scam Protect Prototype Works

This prototype is a copy of a normal Westpac banking app with **Scam Protect** built in. Customers can pay people and businesses, pay bills, transfer money and manage their card as usual. Before money leaves their account, the app checks the payment for signs of a scam, explains what it found in plain language, and lets the customer decide.

The main new feature is the **invoice scanner**. Anyone can use it, but it's designed mainly for paying businesses.

## Running the app

The app now has a **backend server**: every scam check runs on the server, and the app only shows the results.

1. Install [Node.js](https://nodejs.org) (version 22.13 or newer, which includes the built-in database).
2. Open a terminal in the project folder and run `npm install` (first time only).
3. Run `npm start`.
4. Open **http://localhost:3000** in a web browser (Chrome or Edge works best).

The first start creates the database (`data/scamprotect.db`) and fills it with the demo data. To put it back to the demo data at any time, for example to clear scam reports made while testing, stop the server and run `npm run reset-db`.

The server only accepts connections from your own computer. To let other devices on your network open it (for example a phone for the demo), start it with `$env:HOST = "0.0.0.0"; npm start` in PowerShell, then open `http://<your computer's IP address>:3000` on the other device.

If you open `index.html` directly, or the server isn't running, the app shows a "Scam Protect server isn't running" screen with these steps.

The server uses demo data, so no internet is needed. The only exception is the **first photo** you scan: the server downloads Tesseract's English text-recognition data (about 10 MB) once.

To start fresh during a demo, go to **More → Reset demo**.

### Using the real ABN Lookup

The server can check ABNs against the real Australian Business Register instead of the demo data. That needs a free **GUID** (an access key) from the register:

1. Register at **https://abr.business.gov.au/Tools/WebServices** (choose "Register for web services") with your name and email. The GUID is emailed to you.
2. Start the server with the GUID and demo mode turned off. In PowerShell:
   ```
   $env:MOCK = "false"; $env:ABN_GUID = "your-guid-here"; npm start
   ```

Turning demo mode off affects every service. The bank-only services (name check, PayID, scam reports, BPAY) then return "couldn't check" until Westpac's own connections are added. The demo ABNs won't be found either, because they're made up. For the hackathon demo, leave demo mode on.

## Files

| File or folder | What it does |
|---|---|
| `index.html` | The app: screens and design. It sends what the customer enters to the server and shows the results. |
| `apis.js` | The app's connection to the server, with a list of every server route. |
| `server/server.js` | The web server. It serves the app and the API. Only the app and sample files are served; the server's own code isn't. |
| `server/checks.js` | All the scam checks: name check, Scam Risk Score, answers to the scam questions, invoice checks (business, bank account, email, signs of editing), message checker and big payment plan rules. |
| `server/services.js` | Outside services the checks use: ABN Lookup, Confirmation of Payee, PayID, scam intelligence, BPAY and overseas registers. Each one runs on demo data, with notes on the real service. |
| `server/reader.js` | Reads invoice files: PDFs (text, fonts, edit history) with PDF.js, and photos (text and letter sizes) with Tesseract text recognition. |
| `server/db.js` | The database: creates the tables, loads the demo data and holds every query. |
| `server/seed.js` | The demo data loaded into a new database. |
| `data/scamprotect.db` | The database file (created on first start, not served to the browser). |
| `package.json` | Lists the two libraries the server uses; `npm install` installs them. |
| `sample-invoice-*` | Sample invoices for the demo (see Demo test data). |
| `Info.md` | The hackathon brief and the product plan. |

## The database

The server keeps its data in a SQLite database (`data/scamprotect.db`). SQLite is built into Node.js, so there's nothing extra to install.

| Table | What's in it |
|---|---|
| `abn_register` | Australian Business Register records: ABN, name, status, active date, GST, business names |
| `bank_accounts` | Accounts at Westpac and other banks, used for the name check: holder name, personal or business, bank, date opened, linked ABN |
| `payids` | PayIDs and the account each one points to |
| `scam_intel` | Accounts confirmed as scams by the fraud team or other banks |
| `scam_reports` | Scam reports from customers: one per customer per account |
| `bpay_billers` | The BPAY biller directory |
| `overseas_register` | UK Companies House and NZ business numbers |
| `customers` | Customer profiles, including KYC status, KYC level and risk rating |
| `kyc_documents` | Identity documents (masked numbers, how and when they were verified, expiry dates) |
| `kyc_checks` | Identity and screening checks: document check, face match, liveness, sanctions and PEP screening |
| `sessions` | Signed-in browser sessions |
| `check_log` | An audit log of every payment and invoice check (type, score, level and time; no invoices or bank details) |

**KYC in the app:** **More → Your identity (KYC)** shows the customer's identity status, documents and checks, read from the database. The demo customer, Alex Chen, is fully verified. There's also an unverified customer (Jamie Taylor) in the database, to show that only verified customers can report scams.

## Security

- **Your own computer only:** the server only accepts connections from this computer unless you choose to share it (see Running the app).
- **Sessions:** loading the app gives the browser a session cookie that other sites can't read or send. Every API call needs it.
- **JSON only:** the server rejects requests that aren't JSON, which stops other websites from sending requests through your browser.
- **Scam reports:**
  - Only customers with a verified identity can report.
  - Each customer can report an account once, and only reports from verified customers are counted.
  - Each customer can make up to 10 reports an hour.
- **Rate limits:** each IP address can make up to 300 requests a minute, 15 invoice uploads a minute and 20 reports a minute.
- **Safe file reading:**
  - The server reads one photo at a time.
  - It rejects unsupported files and images larger than 40 megapixels.
  - It stops reading a PDF after 20 seconds, or a photo after 60 seconds.
- **Database queries** use bound parameters, so typed text can't change a query.
- **Security headers:** a Content Security Policy (no outside scripts, images or connections), no embedding in other sites, and no referrer.
- **Only the app and sample files are served.** The server's code and the database file aren't.
- **Errors are logged**, and the server keeps running.

## Guiding principle: inform, never block

The app **never stops a payment**, even when the risk is 100 out of 100. Its job is to give the customer all the information it has, at the moment they're about to pay, and then let them make their own decision. The strongest warning recommends "Don't pay", but "I understand the risks, pay" is always available.

## The screens

The bottom bar has five tabs:

| Tab | What's there |
|---|---|
| **Home** | Greeting and total balance, account cards, quick buttons (Pay, Transfer, Scan invoice, BPAY), the Scam Protect banner, the big payment card, and recent activity. |
| **Pay** | Pay someone, scan an invoice, pay a bill (BPAY), transfer between accounts, plan a big payment, and saved payees and billers. |
| **Scan** | The invoice scanner (the raised red button). |
| **Cards** | The debit card, with a lock toggle, card limits and report lost or stolen. |
| **More** | Profile, Scam Protect tools (including "Check a suspicious message"), settings and Reset demo. |

Tapping an account opens its BSB, account number and transactions. Any payment to another account has a **Report as scam** link.

## What happens when you pay someone

1. **Fill in the details.** Choose a saved payee from the dropdown, or pick "Enter new details" and type a name, BSB and account number, or a PayID. Tick **"I'm paying a business"** if it's a tradie, shop or supplier.
2. **Live name check.** While you type, the app checks the name against the account and shows the result straight away (see below).
3. **Review.** The review screen shows the payment details, whether the account is at Westpac or another bank, and every check result.
4. **Confirm.** The app works out a **Scam Risk Score** and responds based on it:

| Score | What the customer sees |
|---|---|
| **0–29 (low)** | The payment goes straight through. |
| **30–49 (medium)** | A short note explaining what looks unusual, then a "Pay" button. |
| **50+ (high)**, or any unplanned big payment | The reasons, plus three quick questions. |

5. **The three questions:**
   - Did someone contact you out of the blue and ask you to make this payment?
   - Did you get these bank details from an email, text or call, rather than directly from the person or business?
   - Are you being rushed, or asked to keep this payment secret?

   Each "yes" adds 15 points.
   - **Any "yes", a scam report, or a total of 70 or more:** the strongest warning appears, explaining what the answers mean and advising the customer to call the person or business on a number they find themselves. The buttons are **Don't pay (recommended)**, **Talk to us first** and **I understand the risks, pay**.
   - **All "no" and a lower score:** a softer note and a "Pay" button.

6. **Receipt.** It shows a receipt number, the new balance and the risk score, with a **Report this as a scam** link.

### The name check

| Result | Meaning |
|---|---|
| **Name matches** | The account belongs to the name you typed. |
| **Close match** | Similar but not exact, so check the spelling. |
| **Name doesn't match** | The account doesn't belong to that name. This is a common scam trick. |
| **Couldn't check** | The account isn't in the name-check system. Only pay if you got the details directly. |
| **Personal account** | You said you're paying a business, but it's a personal account. This is only known for Westpac accounts. |

For privacy, the app never shows the real account holder's name. For PayIDs it shows the registered name, because that's how PayID already works.

The app also warns about **scam reports** from other customers. 1–4 reports show as "possible scam, not yet confirmed" in amber; 5 or more confirmed reports show as red. It also warns about **very new accounts**, which scammers often use.

## The Scam Risk Score

Every payment to someone else gets a score from 0 to 100. The points match the plan in `Info.md`.

**Raises the score:**

| Signal | Points |
|---|---|
| Account confirmed as a scam | +50 |
| Account reported by other customers (not yet confirmed) | +15 to +35 |
| Name doesn't match the account | +30 |
| Business's bank details changed since your last payment (invoice) | +30 |
| Invoice ABN invalid, not registered, cancelled, or the name doesn't match | +30 |
| Invoice looks edited (fonts, PDF edit history, image editing) | +25 |
| Invoice email from a lookalike or unrelated address | +25 |
| Paying a business, but it's a personal account | +20 |
| Account is very new or suddenly receiving lots of payments | +20 |
| Big payment ($2,000+) to someone you don't pay regularly, not planned | +20 |
| Much more than you usually send | +10 to +20 |
| Invoice email says bank details changed or asks to pay urgently | +15 |
| Business's ABN is less than 12 months old | +15 |
| You haven't paid this account before | +15 |
| Warning words in the description (e.g. "urgent", "ATO", "crypto") | +15 |
| Uses more than half your balance | +10 |
| Each "yes" to a scam question | +15 |

**Lowers the score:**

| Signal | Points |
|---|---|
| You've paid this account 3 or more times before | −20 |
| You planned this big payment (within the planned amount) | −15 |
| Invoice fully checked out | −15 |
| Name matches the account | −10 |

## The invoice scanner

### Adding an invoice

The scanner screen explains the three steps (add your invoice, we check it, you decide) and has three buttons in a row:

| Button | What it does |
|---|---|
| **Upload** (left, selected by default) | Shows the "Upload or drag an invoice here" area. Tap it to choose an image, PDF or saved email, or drag a file onto it. You can also paste a screenshot with Ctrl+V. |
| **Email** (middle) | Shows the box for pasting an email. In the real app, the customer taps Share in their email app and chooses Westpac. In the prototype, paste the whole email, including the "From" line. |
| **Photo** (right) | Opens a camera inside the phone, like tapping "Take a photo" in other apps. The viewfinder shows an invoice on a desk with yellow framing corners. Press the round **shutter** button to take the photo (the screen flashes and the shot freezes), then **Use Photo** to send it, or **Retake**. The photo goes to the server and is read like any real photo. The ✕ closes the camera. In the prototype the camera always "photographs" the Bright Spark Electrical sample invoice; a real app would use the phone's camera. |

The selected button (Upload or Email) is red and the other is white. Only the selected button's section shows underneath.

The file is sent to the server, which reads it: PDFs with PDF.js, and photos with Tesseract text recognition.

### The results

Results appear in this order:

1. **The verdict at the top:** "Everything checks out" (green), "A few things to double-check" (amber) or "This could be a scam" (red), in plain language.
2. **What we checked:** the individual checks, grouped under **The business**, **Bank account**, **The email** and **The invoice itself**.
3. **The payment details** read from the invoice. Every field can be edited.
4. **The next step:** "Pay this invoice", or for a possible scam, "Don't pay this invoice" and "Continue to payment".

The app reads the invoice and fills in the business name, ABN, bank account name, BSB, account number, amount and reference. Every field can be edited, and the checks rerun as you type.

### What it checks

1. **ABN:** the number is valid, registered and active, and how long it has been active. It also checks the business is registered for GST if the invoice charges GST.
2. **Business name:** the name on the invoice matches the ABN record.
3. **Bank account:** the account name matches the business, it hasn't been reported, it isn't a personal account, and it isn't brand new.
4. **Changed bank details:** the BSB and account are the same as the last time you paid this business.
5. **The email** (if shared):
   - The sender's address matches the one the business used before.
   - It isn't a lookalike or free email address.
   - It doesn't say "our bank details have changed" or push you to pay urgently.
   - Earlier messages in the chain came from the same address.
6. **Signs of editing:**
   - The bank details are in a different font or text size from the rest of the invoice.
   - The PDF was changed after it was created, was saved by a PDF editing tool instead of accounting software, or was saved more than once.
   - An image was edited with software like Photoshop or Canva.
   - The font is different from previous invoices from this business.
7. **Overseas businesses:** UK and NZ business numbers can be checked. US EINs and UK UTRs can't, so the app says so instead of showing "Verified".

The results appear as a green, amber and red checklist with a summary. If there are serious problems, the main button becomes **"Don't pay this invoice"**, but the customer can still continue to the payment. Paying then goes through the normal pay flow, and the invoice results feed into the risk score.

The app only remembers an invoice's bank details for next time if the invoice had no serious problems. That way a scam invoice can't become the "normal" details.

### Scanned invoice history

Every invoice you scan is saved to a history:

- **On the scanner screen**, the three most recent scans appear under **Previously scanned**, with a **See all** link.
- **The full list** is under **More → Scanned invoices**.

Each entry shows the business, the amount, the result (**Checks passed**, **Check the details** or **Possible scam**), when it was scanned, and what happened next:

| Status | Meaning |
|---|---|
| **Checked** | Scanned, but no payment started yet |
| **Payment started** | The customer went on to the payment screen |
| **Paid** | The payment was sent |
| **Not paid** | The customer chose "Don't pay this invoice" or cancelled the payment. Any invoice flagged as a possible scam also always shows **Not paid** unless it was actually paid |

**Paid invoices** can be reopened to view the checks, but there are no payment buttons. Instead the screen shows "Paid", with the amount and date, and the details can't be edited, so the same invoice can't be paid twice by mistake.

**Grouped by month:** the full list is grouped into months (for example "November 2026"). Each month shows how many invoices were scanned and how much was paid. The sort menu switches between **Newest month first** and **Oldest month first**.

**Removing invoices:** tap **Select**, tick the invoices you want to remove (or **Select all**), then tap **Remove selected**. **Cancel** leaves select mode without removing anything.

Tapping an entry reopens the invoice, including any details the customer corrected, and runs all the checks again with the latest information. For example, a business that has been reported as a scam since then would now be flagged. The history is saved in the browser, so it survives a page reload. Images of photographed invoices are only kept until the page reloads. **Clear history** empties the list, and **Reset demo** clears it too.

## The big payment plan

This is for large planned payments such as a car, a builder, a house deposit or a new supplier.

- **Without a plan:** any payment of $2,000 or more to someone you don't pay regularly gets the three scam questions.
- **Setting up a plan:** the customer taps **"Planning a big payment?"**, chooses what it's for and roughly how much, and answers the three scam questions.
- **No waiting period:** the plan is ready straight away. A small **Plan ready** label shows in the top corner.
- **For 7 days**, big payments up to the planned amount (with 10% leeway) go through without the extra questions. Name checks and scam reports still apply.
- **Any "yes" to the questions** means the plan isn't set up. The app explains why and offers "Talk to us now". The customer can still pay, but the payment gets the normal check.
- **Paying more than the planned amount** gets the normal check, with a note explaining why.
- **Cancel this plan** removes it at any time.

## Other features

- **BPAY:** pay saved or new billers. The biller code is checked against the BPAY directory.
- **Transfers** between your own accounts aren't scam-checked, because the money stays with you.
- **Check a message** (under More): paste a text or email to check it for scam signs.
- **Report as scam:** reports immediately feed into warnings for other payments in the demo.

## Demo test data

All names, account numbers and ABNs are made up. The ABNs pass the real ABN checksum.

**Accounts you can pay (BSB and account):**

| Name | BSB | Account | Notes |
|---|---|---|---|
| Sam Lee | 062-000 | 12345678 | Saved payee, paid 14 times |
| Jordan Smith | 082-401 | 99887766 | Saved payee. Type a different name to see a mismatch |
| Daniel Price | 032-555 | 98765432 | Westpac personal account. Tick "paying a business" to see the warning |
| Bayside Property Rentals | 033-001 | 22334455 | Saved business payee |
| Bright Spark Electrical | 063-010 | 44332211 | Saved business payee |
| Metro Office Supplies | 083-120 | 55667788 | Business |
| Sydney City Motors | 034-002 | 11223344 | Business, ABN 51 824 753 524 (since 2009) |
| Quick Fix Plumbing | 036-111 | 44556677 | Business, ABN 11 458 226 012 (new, under 12 months) |
| Harbour Builders | 037-001 | 88889999 | ABN 73 410 091 807 is cancelled |
| Acme Design LLC | 082-555 | 77881122 | US business |
| K Nguyen | 013-999 | 55551212 | Confirmed scam account (7 reports) |

**PayIDs:**

| PayID | Registered to |
|---|---|
| 0412 345 678 | Sam Lee |
| jordan@email.com | Jordan Smith |
| 62301987403 | Bright Spark Electrical (business) |
| accounts@sydneycitymotors.com.au | Sydney City Motors (business) |
| 0499 000 111 | "Tax Resolution Services", a confirmed scam (12 reports) |

**BPAY billers:** 12345 Harbour Energy, 23456 CityNet Internet, 34567 Metro Water.

**Sample invoice files** (in the project folder, not built into the app):

| File | What it shows |
|---|---|
| `sample-invoice-genuine.txt` | Email and invoice from Bright Spark Electrical. Everything checks out |
| `sample-invoice-scam.txt` | Same invoice with "new bank details" from a lookalike email: reported account, name mismatch, changed details, urgent wording. "This could be a scam" |
| `sample-invoice.png` | An image of the genuine invoice. Everything checks out (the first photo needs internet once, to download the text-recognition data) |
| `sample-invoice.pdf` | The genuine invoice as a PDF. Everything checks out, including "same font as the rest of the invoice" |
| `sample-invoice-edited.pdf` | An edited PDF: the bank details are in a different font (Times New Roman instead of Arial) and point to a reported scam account. "This could be a scam" |

Drag a file onto the Upload area, or open a text file and paste its contents into **Email**.

## Suggested demo flow

1. **Normal payment:** pay Sam Lee $50 from the saved payee dropdown. It goes straight through.
2. **Name mismatch:** pay Jordan Smith's account but type "Telstra Billing". The name check turns red.
3. **Invoice scam:** drag `sample-invoice-scam.txt` onto the scanner. Walk through the red verdict and checklist, continue to payment, answer the questions, and show that the customer still decides.
4. **Genuine invoice:** drag `sample-invoice-genuine.txt` onto the scanner. Everything is green.
   **Edited invoice:** drag `sample-invoice-edited.pdf` onto the scanner to show the different-font check.
5. **Big payment plan:** first pay Sydney City Motors $3,000 without a plan, so the scam questions appear. Then set up a car plan for $5,000, answering "No" to the questions. Pay $3,000 again and it goes straight through.

## Limits of the prototype

- **All outside services return demo data** (see `server/services.js`). A live version needs Westpac's connections to the name check, PayID, BPAY and scam intelligence services.
- **Photos are read on the server** with free text recognition. The first photo needs internet once, and results on real phone photos can be imperfect. If reading fails, the customer can type the details and the checks still run.
- **The customer's own data** (balances, payees, transactions, scan history and big payment plan) lives in the browser for the demo. A real app would keep it on the bank's servers. Because of this, the server trusts what the app tells it about the customer's own history, such as how often they've paid someone.
- **Every browser signs in as the demo customer.** A real app would use the bank's login.
- **Scripts in the page are allowed by the security policy**, because the app uses inline scripts. A production app would move them into separate files so the policy can be stricter.
- **Sharing from the email app** can't happen in a web page, so the prototype uses paste and email files instead.
- **Balances and payees reset when the page reloads.** Only the big payment plan and the scanned invoice history are saved in the browser.
- **Some data isn't available for every account.** Account type (personal or business) and account age are only known for Westpac accounts. For other banks, the app relies on the name check, the ABN and shared scam reports.
