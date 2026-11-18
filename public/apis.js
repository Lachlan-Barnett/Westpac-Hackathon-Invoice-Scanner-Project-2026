/*
 * apis.js - the app's connection to the Scam Protect server.
 *
 * Every scam check runs on the server (see the server/ folder). The app sends what the customer
 * entered and shows the results. Start the server with `npm start` and open http://localhost:3000.
 *
 *  Call               Server route                  What the server does
 *  health             GET  /api/health              Is the server running?
 *  nameCheck          POST /api/payment/namecheck   Name on the account, PayID lookup, scam reports
 *  reviewPayment      POST /api/payment/review      Name check + Scam Risk Score
 *  answers            POST /api/payment/answers     What the answers to the 3 scam questions mean
 *  readInvoice        POST /api/invoice/read        Reads a PDF or photo (text, fonts, edit history)
 *  analyzeInvoice     POST /api/invoice/analyze     Every invoice check
 *  checkMessage       POST /api/message/check       Scam signs in a text or email
 *  startPlan          POST /api/plan/start          Big payment plan rules
 *  report             POST /api/intel/report        Report an account as a scam (verified customers, once each)
 *  customer           GET  /api/customer/me         The signed-in customer's profile and identity (KYC) record
 *  biller             GET  /api/bpay/:code          BPAY biller lookup
 */
(function (global) {
  'use strict';
  // Every call is announced as an "api-call" event, so the Backend panel next to the phone can list it
  const announce = detail => { try { global.dispatchEvent(new CustomEvent('api-call', { detail })); } catch (e) { /* no listeners */ } };
  async function call(method, path, body) {
    let r;
    const start = Date.now();
    try {
      r = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      announce({ method, path, status: 0, ms: Date.now() - start, body, data: { error: e.message } });
      throw new Error("Can't reach the Scam Protect server. Start it with npm start.");
    }
    let data = {};
    try { data = await r.json(); } catch (e) { /* not JSON */ }
    announce({ method, path, status: r.status, ms: Date.now() - start, body, data });
    if (!r.ok) throw new Error(data.error || 'Server error ' + r.status);
    return data;
  }
  global.WestpacAPI = {
    health: () => call('GET', '/api/health'),
    nameCheck: b => call('POST', '/api/payment/namecheck', b),
    reviewPayment: b => call('POST', '/api/payment/review', b),
    answers: b => call('POST', '/api/payment/answers', b),
    readInvoice: b => call('POST', '/api/invoice/read', b),
    prepareInvoice: b => call('POST', '/api/invoice/prepare', b),
    analyzeInvoice: b => call('POST', '/api/invoice/analyze', b),
    invoicePaid: b => call('POST', '/api/invoice/paid', b),
    invoiceCallback: b => call('POST', '/api/invoice/callback', b),
    emailChecks: () => call('GET', '/api/email/checks'),
    emailCheck: id => call('GET', '/api/email/checks/' + encodeURIComponent(id)),
    checkMessage: text => call('POST', '/api/message/check', { text }),
    startPlan: b => call('POST', '/api/plan/start', b),
    report: (key, name) => call('POST', '/api/intel/report', { key, name }),
    biller: code => call('GET', '/api/bpay/' + encodeURIComponent(code)),
    customer: () => call('GET', '/api/customer/me'),
  };
})(window);
