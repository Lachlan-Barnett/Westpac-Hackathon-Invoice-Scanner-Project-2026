# Westpac Scam Protect (Hackathon 2026 prototype)

Phone-style Westpac banking app with **Scam Protect** (name check, scam reports, risk score, invoice scanner, big payment plan). The user is preparing it for a hackathon demo.

## Run
- `npm install` (once), `npm start` → http://localhost:3000 (Node ≥22.13, built-in `node:sqlite`).
- `npm run reset-db` (server stopped) restores demo data in `data/scamprotect.db`. **Do this after any testing that files scam reports.** Reports persist, and the demo customer is limited to 10 an hour.
- **Restart the server after editing `server/*.js`.** `index.html` and `apis.js` are read from disk on each request.
- Stop the server on Windows: `powershell -c "Get-NetTCPConnection -LocalPort 3000 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }"`.

## Layout
- `index.html`: all UI (CSS, HTML, one inline script). **No check logic.** It calls the server through `apis.js` (`window.WestpacAPI`).
- `server/server.js`: HTTP server, whitelisted static files, sessions (`sp_sid` cookie set on loading index), JSON-only POSTs, rate limits, security headers, listens on 127.0.0.1 (`HOST` env to share).
- `server/checks.js`: name check, Scam Risk Score (points match `Info.md`), answers verdict, invoice analysis (business / bank account / email / document tampering), message check, plan rules.
- `server/services.js`: ABN, CoP, PayID, intel and reports (KYC-verified customers only, one per account, 10/hr), BPAY, overseas registers, KYC profile. `MOCK=false` plus env URLs switches to real services.
- `server/reader.js`: PDF.js (fonts, edit history) and Tesseract OCR (cap heights; one at a time; size and time limits).
- `server/db.js` (schema and queries, 12 tables) and `server/seed.js` (demo data: ABNs pass the checksum, KYC for Alex Chen = verified, Jamie Taylor = pending).
- Docs: `HOW_IT_WORKS.md` (keep in sync with every feature change), `Info.md` (product plan; parts still describe a business-only scope, which is outdated).
- Sample files: `sample-invoice-genuine.txt`, `-scam.txt`, `.png`, `.pdf`, `-edited.pdf` (different font + scam account).

## Product rules the user set
- **Inform, never block.** Payments are never blocked. The strongest warning offers "Don't pay (recommended)", "Talk to us first" and "I understand the risks, pay".
- **Big payment plan:** no waiting period. The 3 scam questions are asked at setup, and any "yes" means no plan. The plan covers payments up to the planned amount (+10%) for 7 days.
- **Scope:** a normal customer app (P2P and business). The invoice scanner is for business invoices but anyone can use it.
- **Scanner tiles:** Upload (default, red), Email, Photo. Photo opens a **mock camera** that "photographs" `sample-invoice.png`.
- **Scan history:** grouped by month, select/remove. Paid scans are read-only. Possible scams show "Not paid" unless paid.
- **Westpac GEL palette:** hero #DA1710, headings #1F1C4F, muted #575F65, border #DEDEE1, ok #008A02, warn #C53B00, bad #C80038. No emojis in docs.
- **Don't publish the Westpac-branded app** as a public link; a de-branded copy is OK if asked.
- The user wants plain, customer-friendly wording.

## Working notes (this machine)
- Windows. Bash heredocs with quotes or backticks often break. Write scripts to the scratchpad and run them (`python -I script.py`).
- Edit/Write need a Read of the file first. For big replacements, use Python with `assert s.count(old) == 1`.
- Testing: jsdom is installed in `%TEMP%/wptest`. Use `JSDOM.fromURL('http://127.0.0.1:3000/')`, override `w.fetch` to add `cookie: dom.cookieJar.getCookieStringSync(BASE)`, and stub canvas. Take screenshots with headless Chrome (`--headless=new --screenshot`).
- Back up a file to `%TEMP%` before large edits.
