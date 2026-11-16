# Test invoices: expected results

Upload these in the app: **Pay a business → Pay a new business (or a saved one) → Upload an invoice**.
They work in demo mode (recognised by file content) and with a Gemini key (AI reads them live).
Reset the database first (staff console → *Reset to sample data*) so earlier test payments don't trigger the transfer-pattern check.

| File | Business | Amount | Expected | Why |
|---|---|---|---|---|
| T01_robina_roofing_genuine.png | Robina Roofing Pty Ltd | $18,700.00 | 🟢 Green | Registered business, KYC-verified account linked to its ABN, everything consistent (first payment to them). |
| T02_southport_furniture_small.png | Southport Furniture Co Pty Ltd | $3,850.00 | ⚡ Quick pay | Under $5,000 to a saved business, so it goes straight to review with no checks. |
| T03_ormeau_tiling_genuine.png | Ormeau Tiling & Stone Pty Ltd | $9,350.00 | 🟢 Green | Real tiler, verified account, totals and contact details match the register. |
| T04_tweed_landscaping_nsw.png | Tweed Coast Landscaping Pty Ltd | $6,600.00 | 🟢 Green | Interstate (NSW) business, verified account, consistent invoice. |
| T05_helensvale_electrical_sole_trader.png | Helensvale Electrical Services | $5,500.00 | 🟢 Green | Sole trader trading as Helensvale Electrical Services. Account 'S PATTERSON' is KYC-linked to the ABN, so it passes. |
| T06_robina_roofing_wrong_account.png | Robina Roofing Pty Ltd | $7,040.00 | 🔴 Red | Real Robina Roofing invoice, but the bank account is registered to a different business's ABN (Ormeau Tiling). |
| T07_labrador_car_rentals_cancelled_abn.png | Labrador Car Rentals Pty Ltd | $7,200.00 | 🔴 Red | The ABN belongs to a business whose ABN is CANCELLED on the register. |
| T08_burleigh_conveyancing_settlement_scam.png | Burleigh Conveyancing Pty Ltd | $48,500.00 | 🔴 Red | Property-settlement scam: look-alike domain, bank details 'changed' to a personal mule account with incomplete KYC that's in the scam reports, urgent wording. |
| T09_ormeau_tiling_gmail_amber.png | Ormeau Tiling & Stone Pty Ltd | $6,160.00 | 🟡 Amber | Real business and its verified account, but sent from a Gmail address with a different mobile number, so confirm first. |
| T10_unknown_business_valid_abn.png | Gold Coast Espresso Machines Pty Ltd | $11,550.00 | 🟡 Amber | Valid ABN and plausible invoice, but the business and bank account aren't in the bank's records (ABR GUID: live register check). |
| T11_name_does_not_match_abn.png | Robina Roof Repairs | $9,240.00 | 🔴 Red | Invoice says 'Robina Roof Repairs' but the ABN is registered to Pacific Pines Pool Builders. |
| T12_invalid_abn_typo.png | Robina Roofing Pty Ltd | $6,490.00 | 🔴 Red | The ABN is one digit off (fails the ATO checksum): a typo or a fake. |
| T13_wrong_gst_maths.png | Tweed Coast Landscaping Pty Ltd | $6,900.00 | 🔴 Red | GST doesn't equal 10% of the subtotal, so the invoice has been altered or is fake. |
| T14_robina_roofing_genuine.pdf | Robina Roofing Pty Ltd | $18,700.00 | 🟢 Green | Same as T01 but as a PDF (tests PDF upload; with AI on, Gemini reads the PDF). |

All invoices are fictional and billed to Coomera Coffee Roasters Pty Ltd (the demo business customer).
