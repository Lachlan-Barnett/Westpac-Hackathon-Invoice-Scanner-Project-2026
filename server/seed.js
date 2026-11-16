'use strict';
/*
 * Demo data loaded into a new database. All names, ABNs, account numbers and identity details
 * are made up. ABNs pass the real ABN checksum.
 */
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

module.exports = {
  // ---------------------------------------------------------------- Australian Business Register (ABN Lookup)
  abnRegister: [
    { abn: '51824753524', name: 'Sydney City Motors', entityName: 'SYDNEY CITY MOTORS PTY LTD', status: 'Active', activeFrom: '2009-03-02', cancelledFrom: null, gst: 1, businessNames: ['Sydney City Motors'] },
    { abn: '33051775524', name: 'Bayside Property Rentals', entityName: 'BAYSIDE PROPERTY GROUP PTY LTD', status: 'Active', activeFrom: '2012-06-18', cancelledFrom: null, gst: 1, businessNames: ['Bayside Property Rentals'] },
    { abn: '11458226012', name: 'Quick Fix Plumbing', entityName: 'QUICK FIX PLUMBING PTY LTD', status: 'Active', activeFrom: '2026-07-01', cancelledFrom: null, gst: 0, businessNames: ['Quick Fix Plumbing'] },
    { abn: '73410091807', name: 'Harbour Builders', entityName: 'HARBOUR BUILDERS PTY LTD', status: 'Cancelled', activeFrom: '2015-02-10', cancelledFrom: '2025-09-30', gst: 0, businessNames: ['Harbour Builders'] },
    { abn: '62301987403', name: 'Bright Spark Electrical', entityName: 'BRIGHT SPARK ELECTRICAL PTY LTD', status: 'Active', activeFrom: '2018-04-03', cancelledFrom: null, gst: 1, businessNames: ['Bright Spark Electrical'] },
    { abn: '47556120322', name: 'Metro Office Supplies', entityName: 'METRO OFFICE SUPPLIES PTY LTD', status: 'Active', activeFrom: '2011-09-12', cancelledFrom: null, gst: 1, businessNames: ['Metro Office Supplies'] },
  ],

  // ---------------------------------------------------------------- Accounts at Westpac and other banks (Confirmation of Payee)
  bankAccounts: [
    { bsb: '062000', account: '12345678', holder: 'Sam Lee', type: 'personal', bank: 'CBA', opened: daysAgo(2400) },
    { bsb: '082401', account: '99887766', holder: 'Jordan Smith', type: 'personal', bank: 'NAB', opened: daysAgo(1800) },
    { bsb: '032555', account: '98765432', holder: 'Daniel Price', type: 'personal', bank: 'Westpac', opened: daysAgo(3100) },
    { bsb: '033001', account: '22334455', holder: 'Bayside Property Rentals', type: 'business', bank: 'Westpac', opened: daysAgo(4200), abn: '33051775524' },
    { bsb: '063010', account: '44332211', holder: 'Bright Spark Electrical', type: 'business', bank: 'CBA', opened: daysAgo(2900), abn: '62301987403' },
    { bsb: '083120', account: '55667788', holder: 'Metro Office Supplies', type: 'business', bank: 'NAB', opened: daysAgo(5000), abn: '47556120322' },
    { bsb: '034002', account: '11223344', holder: 'Sydney City Motors', type: 'business', bank: 'Westpac', opened: daysAgo(6000), abn: '51824753524' },
    { bsb: '036111', account: '44556677', holder: 'Quick Fix Plumbing', type: 'business', bank: 'Westpac', opened: daysAgo(120), abn: '11458226012' },
    { bsb: '037001', account: '88889999', holder: 'Harbour Builders', type: 'business', bank: 'Westpac', opened: daysAgo(3500), abn: '73410091807' },
    { bsb: '082555', account: '77881122', holder: 'Acme Design LLC', type: 'business', bank: 'NAB', opened: daysAgo(900) },
    { bsb: '013999', account: '55551212', holder: 'K Nguyen', type: 'personal', bank: 'ANZ', opened: daysAgo(21) },
    { bsb: '032888', account: '77776666', holder: 'M Rossi', type: 'personal', bank: 'Westpac', opened: daysAgo(14) },
  ],

  // ---------------------------------------------------------------- PayIDs (NPP Addressing Service)
  payids: [
    { payid: '0412345678', holder: 'Sam Lee', type: 'personal', accountKey: '06200012345678' },
    { payid: 'jordan@email.com', holder: 'Jordan Smith', type: 'personal', accountKey: '08240199887766' },
    { payid: '62301987403', holder: 'Bright Spark Electrical', type: 'business', accountKey: '06301044332211' },
    { payid: 'accounts@sydneycitymotors.com.au', holder: 'Sydney City Motors', type: 'business', accountKey: '03400211223344' },
    { payid: '0499000111', holder: 'Tax Resolution Services', type: 'personal', accountKey: '03288877776666' },
  ],

  // ---------------------------------------------------------------- Confirmed scam intelligence (fraud team and other banks)
  scamIntel: [
    { accountKey: '01399955551212', confirmedReports: 7, confirmed: 1, source: 'Westpac fraud team + Australian Financial Crimes Exchange' },
    { accountKey: '03288877776666', confirmedReports: 12, confirmed: 1, source: 'Westpac fraud team' },
  ],

  // ---------------------------------------------------------------- BPAY billers
  billers: [
    { code: '12345', name: 'Harbour Energy' },
    { code: '23456', name: 'CityNet Internet' },
    { code: '34567', name: 'Metro Water' },
  ],

  // ---------------------------------------------------------------- Overseas business registers
  overseas: [
    { registry: 'companies_house', number: '01234567', name: 'Acme Design Ltd', status: 'active' },
    { registry: 'nzbn', number: '9429041234567', name: 'Kiwi Print Co', status: 'active' },
  ],

  // ---------------------------------------------------------------- Customers and KYC (Know Your Customer)
  customers: [
    { id: 1, firstName: 'Alex', lastName: 'Chen', dob: '1990-04-12', email: 'alex.chen@email.com', mobile: '0412 000 111',
      address: '8 Ocean Parade, Wollongong NSW 2500', customerSince: '2014-03-18', kycStatus: 'verified', kycLevel: 'Full', kycVerifiedAt: '2024-02-10', riskRating: 'Low' },
    { id: 2, firstName: 'Jamie', lastName: 'Taylor', dob: '1998-11-02', email: 'jamie.taylor@email.com', mobile: '0413 222 333',
      address: '22 King St, Newtown NSW 2042', customerSince: '2026-11-10', kycStatus: 'pending', kycLevel: 'None', kycVerifiedAt: null, riskRating: 'Unrated' },
  ],
  kycDocuments: [
    { customerId: 1, docType: 'NSW driver licence', numberMasked: '•••• 7731', verifiedVia: 'Document Verification Service (DVS)', verifiedAt: '2024-02-10', expires: '2029-09-30', status: 'verified' },
    { customerId: 1, docType: 'Australian passport', numberMasked: 'PA••••312', verifiedVia: 'Document Verification Service (DVS)', verifiedAt: '2014-03-18', expires: '2031-05-21', status: 'verified' },
    { customerId: 2, docType: 'NSW driver licence', numberMasked: '•••• 2210', verifiedVia: null, verifiedAt: null, expires: '2030-01-15', status: 'pending' },
  ],
  kycChecks: [
    { customerId: 1, checkType: 'Identity document check (DVS)', result: 'pass', checkedAt: '2024-02-10' },
    { customerId: 1, checkType: 'Face match to ID photo', result: 'pass', checkedAt: '2024-02-10' },
    { customerId: 1, checkType: 'Liveness check', result: 'pass', checkedAt: '2024-02-10' },
    { customerId: 1, checkType: 'Sanctions and PEP screening', result: 'clear', checkedAt: '2026-11-01' },
    { customerId: 2, checkType: 'Identity document check (DVS)', result: 'pending', checkedAt: '2026-11-10' },
  ],
};
