# Westpac Hackathon 2026 Information Booklet

Challenge users to build innovative solutions that explore how AI could reshape the way customers interact with their bank and how banks deliver products and services. From AI-powered financial coaching and intelligent customer service to autonomous banking agents and personalised experiences, the possibilities are endless.

## Task

- Show how AI can make banking simpler, smarter, safer and more intuitive for customers and employees alike.
- Solution should be user-friendly, secure, and demonstrate the potential to disrupt traditional banking services.
- Identify, Innovate and improve one or more banking aspects for customers by developing a functional prototype or application

## What Westpac Does

### App & Online Banking:
The westpac app handles account transfers, mobile cheque deposits (under $5,000), split expenses, and scheduled transfers up to 24 months in advance.

### Payment Methods:
Operates via standard BSB and account numbers, mobile-linked PayIDs, BPAY (for over 45,000 billers), and PayTo for recurring or one-off digital debits.

### Security:
Protected by the Westpac Protect Online Banking Security Guarantee, which refunds eligible compromised funds if terms are met.

## Competition Methods

Commbank implements scam mitigation through a multi-layered approach combining in-app verification tools, real-time AI detection, scammer disruption bots, and cross-industry intelligence sharing. Name check, caller check, customer check, true view

Customers can upload screenshots of suspicious text messages into this AI-powered tool to check whether the communication is legitimate or a potential phishing attempt.

## Our Idea: How To Mitigate Customer Scams

differentiate between a large transfer as a one off payment e.g. a car and a scam call






### Solid Plans:

**Scope:** this is a **business payments** product. It protects money sent **to a business**, not payments between friends and family. It covers two kinds of payment:
- **Customer to business (C2B):** a customer paying a business, e.g. a tradie, car dealer, builder, real estate agent, or a conveyancer for a house deposit.
- **Business to business (B2B):** a business paying its suppliers, e.g. stock, equipment, contractors and services.

Payments between people (splitting dinner, paying a friend) and transfers between the customer's own accounts are out of scope and work as normal.

**Why businesses:** invoice scams and business email compromise target exactly these payments. Scammers hack or copy a real business's emails and send a real-looking invoice with their own bank details. These payments are often large, and the payer believes they are paying someone they already trust.

**Same bank vs different bank:**
- **Westpac to Westpac:** we can see the receiving account directly (the real account name, whether it's a business or personal account, how new it is, and whether it has been reported). If a scam is confirmed, we can hold the money on both sides.
- **Westpac to another bank:** we use the shared name check (Confirmation of Payee), the Australian Business Register, and scam reports shared between banks to check the receiving account before the money leaves.

**Guiding principle: inform, never block.** The app never stops a customer from making a payment, even at the highest risk score. Its job is to give the customer every piece of information it has, in plain language, at the right moment, and then let them make their own informed decision. The customer always has a way to pay.

All features below feed into one **Scam Risk Score**, so the customer gets one clear message instead of lots of pop-ups.

#### 1. Business name check before you pay

**What the customer sees:** as soon as they enter a BSB, account number and business name, the app shows one of:
- **"Name matches"**: "This account belongs to Sydney City Motors."
- **"Name doesn't match"**: "This account belongs to K N*****, not 'Sydney City Motors'. Scammers often use a real business's name with their own account. Call the business on a number you find yourself to check."
- **"This isn't a business account"**: "This looks like a personal account, not a business account. Real businesses usually get paid into a business account."
- **"We couldn't check the name"**: "Only continue if you got these details directly from the business."

**Why it's customer friendly:** it appears instantly while they type, uses simple words, and suggests what to do next instead of just showing an error.

#### 2. "Reported by other customers" warning

**What the customer sees:** a clear pop-up before paying a business account or PayID that has been reported as a scam:
> **7 customers reported this account as a scam in the last 14 days.**
> We strongly recommend you don't send money to this account.
> [Don't pay] [Tell me more]

**Keeping it fair and accurate:**
- Reports confirmed by our fraud team or other banks count the most.
- Reports from customers who actually lost money or were contacted count more than others, so scammers can't flood the system with fake reports against real businesses.
- Older reports slowly count less, so a business that was wrongly reported isn't flagged forever.
- Businesses that think they were reported by mistake can ask for a review.

**Easy reporting:** after a payment, or from the transaction list, the customer can tap **"Report this as a scam"** in two taps.

#### 3. Pause, inform, and let the customer decide

**What the customer sees:** for a risky payment, a short pause before the money is sent:
> **Before you pay, here's what we found.**
> 7 customers have reported this account as a scam. The bank details are different from the last time you paid Sydney City Motors.
> [Don't pay (recommended)] [Talk to us first] [I understand the risks, pay]

**How it works:**
- Nothing is frozen or blocked. The pause only appears on this one payment, and the rest of the account works as normal.
- For high-risk payments, the customer answers three quick questions, which help them spot a scam themselves:
  1. Did you get these bank details from an email, text or phone call, rather than directly from the business?
  2. Has the business asked you to pay a different account from last time?
  3. Are you being asked to pay urgently, or to keep it quiet?
- The app then explains what the answers mean, e.g. "The business asked you to pay a different account. This is the most common sign of an invoice scam."
- It gives one clear action: **call the business on a phone number you find yourself**, not the one on the invoice or email.
- The customer then chooses:
  - **Don't pay (recommended)**: the payment is cancelled and nothing leaves the account.
  - **Talk to us first**: in-app chat or a call back from a specialist.
  - **I understand the risks, pay**: the payment is sent straight away.
- **The higher the risk, the stronger the wording**, but the customer always makes the final decision.

**For business accounts with more than one user (optional setting):** a business can choose to require a second authorised person (e.g. the owner or finance manager) to approve high-risk payments. This is the business's own control over its staff, not the bank blocking the payment.

#### 4. Invoice scanner

**What the customer does:** taps **"Pay an invoice"** and adds the invoice in whichever way is easiest. The app reads it and fills in the payment details for them (business name, ABN, BSB, account number, amount, reference).

**Ways to add an invoice:**
- **Take a photo:** of a paper invoice, using the in-app camera.
- **Upload or drop in a file:** choose an image (photo or screenshot) or a PDF from the phone's gallery or files. On online banking in a web browser, the customer can drag and drop the file onto the page.
- **From an email:** in their email app, the customer taps **Share** on the email or the invoice attachment and chooses **Westpac**. The app opens straight to "Pay an invoice" with the invoice loaded. If they share the whole email, not just the attachment, the app can also check the email itself (see below).
- **Paste:** copy and paste an invoice screenshot, or the email text, straight into the scanner.

All options lead to the same checklist, so the customer gets the same protection however the invoice arrives.

**What the app checks, and shows as a simple checklist:**
- ABN is real and currently active (via the Australian Business Register's ABN Lookup)
- Business name on the invoice matches the ABN record
- Bank account name matches the business (name check)
- Bank details are the same as the last time you paid this business
- **Warning if details changed:** "This business's bank details have changed since you last paid them. Call the business on a number you find yourself (not the one on the invoice) to confirm."
- **Can't verify:** for overseas businesses (EIN in the USA, UTR or Companies House number in the UK, NZBN in NZ): "We can't verify this automatically", shown instead of a false "Verified".

**Document tampering checks (fonts and layout):** scammers often take a real invoice and change only the bank details. The edit usually leaves traces, so the app checks for:
- **Mismatched fonts:** the bank details (account name, BSB, account number) use a different font, size or style from the rest of the invoice.
- **Misaligned or out-of-place text:** bank details that sit at a slightly different angle, spacing or position, or have a different background, as if pasted in.
- **PDF edit history:** the PDF was changed after it was first created, or was last saved by a PDF editing tool rather than the accounting software that made it (e.g. Xero, MYOB, QuickBooks).
- **Edited images:** signs a photo or screenshot was edited, such as editing software listed in the file's details.
- **Different from previous invoices:** the layout, logo, template or fonts don't match invoices the customer has paid from this business before.

What the customer sees: "The bank details on this invoice look like they were changed. They use a different font from the rest of the invoice. Call the business on a number you find yourself before paying."

**Extra checks when the invoice comes from an email:**
- **Sender matches the business:** the sender's email domain matches the business's real website (e.g. invoices from "@sydneycitymotors.com.au", not "@sydneycitymotors-au.com" or a free Gmail address).
- **Lookalike addresses:** flags addresses that are one letter off, use swapped characters, or have an extra word added to a real business's domain.
- **"Our bank details have changed" wording:** flags emails that say the business has a new bank account, or ask the customer to pay urgently. Both are classic signs of invoice scams.
- **Reply chain changes:** flags when the email continues an older conversation but comes from a different address than earlier messages, a sign the business's email was hacked or impersonated.

**Privacy and safety:**
- The customer chooses exactly what to share. The app never connects to or reads their inbox.
- The bank's server reads the invoice, runs the checks and doesn't keep the file. It only records that a check happened and its result, not the invoice or bank details.
- The customer's scan history keeps the invoice text on their own device so they can reopen it later. They can remove any scan, or clear the history, at any time.
- Customers are never asked to forward emails to a Westpac email address. Scammers could copy that idea with fake "forward your invoice to us" emails.

**Customer-friendly touches:**
- Works however the invoice arrives: paper, screenshot, PDF or email.
- Saves typing and stops typos in BSB/account numbers.
- A green checklist builds trust for real invoices. Only problems need action.
- "Verified" never means the payment skips other checks, because real businesses' email accounts can be hacked and invoices changed.

#### 5. Big business payment plan

**Problem:** large legitimate payments to businesses shouldn't be treated like scams, but large unplanned payments to a business the customer hasn't paid before are exactly what invoice scammers rely on.

**Examples:** a customer buying a car from a dealer, paying a builder's deposit, or a house deposit to a conveyancer. A business paying a new supplier for the first time, or buying equipment.

**Default rule (no plan):** a big payment ($2,000 or more) to a business the customer hasn't paid regularly is **paused automatically**. The customer sees the risk information and answers the 3 quick scam questions, then decides whether to pay. Because this is the default, a scammer can't avoid it by telling the customer to skip the plan.

**The plan is the customer's fast lane:** before a big payment, the customer taps **"Planning a big payment?"**, chooses the type (car, building work, house deposit, new supplier, equipment) and the rough amount, and answers the 3 quick scam questions. There is **no waiting period**: the plan is ready straight away. For the next 7 days, big payments up to the planned amount (with 10% leeway) go through without the automatic pause. The name check and scam report checks always still run.

**Scam questions when setting up the plan:** if the customer answers "yes" to any question, the **plan isn't set up**. The app explains why in plain language and offers **"Talk to us now"**. The customer can still make the payment; it just gets the normal pause and questions.

**Over the planned amount:** a big payment of more than the planned amount gets the normal pause and questions, with a note explaining why. It's never blocked.

**Trade-off of having no wait:** a scammer on the phone could tell the customer to set up a plan and pay straight away. The scam questions at setup are the main protection here, along with the name check and scam reports, which still apply to every payment.

**How a real business payment and an invoice scam differ:**

| Real business payment | Invoice scam |
|---|---|
| Business has an established, active ABN | ABN is new, cancelled, or belongs to a different business |
| Account name matches the business | Account name doesn't match, or it's a personal account |
| Same bank details as last time | "We've updated our bank details" |
| Invoice from the business's real email address | Lookalike or free email address |
| Invoice fonts and layout are consistent | Bank details in a different font, or the PDF was edited |
| Customer planned the payment in advance | Sudden and urgent |

### Scam Risk Score (0 to 100)

Every payment to a business gets a score. The customer never sees the number, only a clear, friendly message based on it.

#### Things that raise the score

| Signal | Points |
|---|---|
| Account confirmed as a scam (by our fraud team or another bank) | +50 |
| Account reported by other customers | +15 to +35 |
| Account name doesn't match the business | +30 |
| Business's bank details changed since last payment | +30 |
| Invoice ABN not valid, cancelled, or name doesn't match | +30 |
| Invoice shows signs of editing (mismatched fonts on bank details, edited PDF or image) | +25 |
| Invoice email sent from a lookalike or unrelated email address | +25 |
| Receiving account is a personal account, not a business account | +20 |
| Receiving account is very new or suddenly receiving lots of payments from different people | +20 |
| Big payment ($2,000+) to a business not paid regularly, with no plan | +20 |
| Invoice email says the bank details have changed, or asks to pay urgently | +15 |
| Never paid this business before | +15 |
| Business ABN registered less than 12 months ago | +15 |
| Much more than the customer usually pays | +10 to +20 |
| Uses more than half of the account balance | +10 |
| Warning words in the description, e.g. "new account", "updated details", "urgent" | +15 |
| Each "yes" to a scam question | +15 |

#### Things that lower the score

| Signal | Points |
|---|---|
| Paid this business 3 or more times before, to the same account | −20 |
| Customer planned this big payment (within the planned amount) | −15 |
| Invoice fully verified (ABN active, names match, details unchanged, no signs of editing) | −15 |
| Account name matches the business | −10 |

#### What the customer sees at each level

| Score | Level | What happens in the app |
|---|---|---|
| 0–29 | Low | Payment goes straight through. No interruptions. |
| 30–49 | Medium | A short tip explaining what looks unusual. Customer taps "Pay" to continue. |
| 50–69 | High | Payment paused. Customer answers 3 quick questions, sees what the answers mean, then chooses to pay or not. |
| 70–100 | Very high | Strongest warning, with everything we found. "Don't pay (recommended)" is the main button, with "Talk to us first" and "I understand the risks, pay" as options. The customer always decides. |

### Legal and data sources

Every check uses information that is either public, belongs to the bank, or is shared by the customer with their consent. This is a summary for the pitch, not legal advice, and would need review by Westpac's legal and privacy teams before launch.

| What we check | Where the information comes from | Can we legally use it? |
|---|---|---|
| ABN is valid, active, how long it's been active, GST registration, registered business names | Australian Business Register (ABN Lookup), which has a free public web service | Yes. ABN details are published so anyone can check who they're dealing with. |
| ABN format check | A public checksum formula | Yes. No data needed. |
| Account name matches (same bank) | Westpac's own customer records | Yes, for preventing fraud. But only show "matches / doesn't match", not the other person's full name, to protect their privacy under the Privacy Act. |
| Account name matches (other bank) | Industry Confirmation of Payee service, being rolled out across Australian banks | Yes, through the official service. It returns a match result, not the account holder's details. |
| Business or personal account | Westpac's own records for Westpac accounts. For other banks, only what the industry name-check service returns | Yes for Westpac accounts. For other banks it may not be available, so the app falls back to the ABN and name checks. |
| Account is new or receiving lots of payments | Westpac's own records, or scam intelligence shared between banks (e.g. through the Australian Financial Crimes Exchange) | Yes. Banks may use and share this to detect and prevent scams and fraud. |
| "Reported by other customers" | Reports from Westpac customers and shared industry scam intelligence | Yes, with care. Show counts and "unconfirmed" wording, have a review process for wrongly reported businesses, and never say a business "is a scam" unless confirmed. This reduces the risk of unfairly damaging a real business. |
| Bank details changed since last payment | The customer's own payment history | Yes. It's the customer's own data. |
| Invoice details, fonts, PDF edit history, image details | The file the customer chose to share | Yes, with the customer's consent. Tell them what is checked and delete the file after. |
| Email sender address, wording, reply chain | The email the customer chose to share | Yes, with consent. The app never reads the customer's inbox. |
| Overseas businesses | UK Companies House and the NZ business register (NZBN) have public lookups. US EINs and UK UTRs can't be publicly checked (a UTR is a private tax number) | Partly. Check Companies House and NZBN where possible, otherwise show "We can't verify this automatically". |
| Scam questions and big payment plan | The customer's own answers | Yes. |

**Laws that support this:**
- The **Scams Prevention Framework** (passed in 2025) requires banks to take reasonable steps to prevent, detect, report, disrupt and respond to scams, and to share scam intelligence. Clear warnings and scam information at the point of payment fit these obligations.
- The **Privacy Act 1988** allows using personal information for a related purpose such as fraud prevention, but the app should share only what's needed (e.g. "name doesn't match", not the real account holder's name).

**One thing to be ready for:** the Scams Prevention Framework expects banks to take *reasonable steps* to disrupt scams. Judges may ask whether "inform, never block" is enough for a confirmed scam account. Our answer: the customer always gets the strongest warning, the recommended option is "Don't pay", and the bank can still report the receiving account and work with the receiving bank to freeze it. That protects other customers without taking the decision away from this one.
