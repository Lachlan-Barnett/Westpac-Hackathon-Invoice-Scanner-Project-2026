# Test invoices: expected results

Upload these in the phone app: **Scan → Upload**, then tap **Check this invoice**.
They work with a Gemini key (AI reads them live) and without one: what Gemini read from each file is saved in `data/test-invoices.json`, so the app recognises them by file content. That also covers you when Gemini is busy.

Paying an invoice adds it to the payment history. Scan the same invoice again and you get *"You've already paid this invoice"* (🟡). To start fresh, use **Reset to sample data** in the staff console.

| File | Business | Amount | Expected | Why |
|---|---|---|---|---|
| T01_robina_roofing_genuine.png | Robina Roofing Pty Ltd | $18,700.00 | 🟢 Green | Registered business, KYC-verified account linked to its ABN, same account and a normal amount compared with the 2 past payments. |
| T02_southport_furniture_small.png | Southport Furniture Co Pty Ltd | $3,850.00 | 🟢 Green | Genuine small payment to a saved business. (The classic app skips checks under $5,000; the phone app always checks.) |
| T03_ormeau_tiling_genuine.png | Ormeau Tiling & Stone Pty Ltd | $9,350.00 | 🟢 Green | Real tiler, verified account, totals and contact details match the register. |
| T04_tweed_landscaping_nsw.png | Tweed Coast Landscaping Pty Ltd | $6,600.00 | 🟢 Green | Interstate (NSW) business, verified account, in line with past invoices. |
| T05_helensvale_electrical_sole_trader.png | Helensvale Electrical Services | $5,500.00 | 🟢 Green | Sole trader trading as Helensvale Electrical Services. Account 'S PATTERSON' is KYC-linked to the ABN, so it passes. |
| T06_robina_roofing_wrong_account.png | Robina Roofing Pty Ltd | $7,040.00 | 🔴 Red | Real Robina Roofing invoice, but the bank account is registered to a different business's ABN (Ormeau Tiling). |
| T07_labrador_car_rentals_cancelled_abn.png | Labrador Car Rentals Pty Ltd | $7,200.00 | 🔴 Red | The ABN is CANCELLED on the register. |
| T08_burleigh_conveyancing_settlement_scam.png | Burleigh Conveyancing Pty Ltd | $48,500.00 | 🔴 Red | Property-settlement scam: look-alike domain, bank details 'changed' to a personal mule account that's in the scam reports, urgent wording. |
| T09_ormeau_tiling_gmail_amber.png | Ormeau Tiling & Stone Pty Ltd | $6,160.00 | 🟡 Amber | Real business and its verified account, but sent from a Gmail address with a different mobile number. **Try the call step:** tap *They confirmed it* and it turns 🟢. |
| T10_unknown_business_valid_abn.png | Gold Coast Espresso Machines Pty Ltd | $11,550.00 | 🔴 Red | Valid ABN, but the business isn't on the register and the bank account belongs to someone else. |
| T11_name_does_not_match_abn.png | Robina Roof Repairs | $9,240.00 | 🔴 Red | Invoice says 'Robina Roof Repairs' but the ABN is registered to Pacific Pines Pool Builders. |
| T12_invalid_abn_typo.png | Robina Roofing Pty Ltd | $6,490.00 | 🔴 Red | The ABN is one digit off (fails the ATO checksum): a typo or a fake. |
| T13_wrong_gst_maths.png | Tweed Coast Landscaping Pty Ltd | $6,900.00 | 🔴 Red | GST doesn't equal 10% of the subtotal, so the invoice has been altered or is fake. |
| T14_robina_roofing_genuine.pdf | Robina Roofing Pty Ltd | $18,700.00 | 🟢 Green | Same as T01 as a PDF. The PDF check confirms it hasn't been edited. |
| **T15_robina_roofing_edited_pdf.pdf** | Robina Roofing Pty Ltd | $9,240.00 | 🔴 Red | A real invoice made in Xero, then **edited in Sejda PDF editor days later** to change the bank details to an unknown account. The PDF check finds this from the file itself; without it, the invoice would only be amber. |
| **T16_ormeau_tiling_payid_qr.png** | Ormeau Tiling & Stone Pty Ltd | $3,960.00 | 🟢 Green | Paid by **PayID** (their ABN) with a QR code. The PayID is registered to Ormeau Tiling, its account is KYC-verified, and the QR code pays the same PayID. Paying it uses the PayID. |
| **T17_robina_roofing_qr_swapped.png** | Robina Roofing Pty Ltd | $6,215.00 | 🔴 Red | Everything printed is genuine, but the **QR code pays a different PayID** (a Gmail PayID registered to 'K LEE'). The classic "sticker over the QR code" scam. |

All invoices are fictional and billed to Coomera Coffee Roasters Pty Ltd (the demo business customer).
The AI risk review can occasionally add an extra warning, so a result may be one step stricter than the table.
