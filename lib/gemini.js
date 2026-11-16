// Google Gemini calls. The API key lives only on the server (.env), never in the browser.
const { num } = require("./util");

const KEY = () => (process.env.GEMINI_API_KEY || "").trim();
let modelOverride = null; // set automatically if Google says the configured model is retired
const MODEL = () => modelOverride || (process.env.GEMINI_MODEL || "gemini-3.8-flash").trim();
const enabled = () => !!KEY();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isBusy = e => /high demand|overloaded|unavailable|try again|quota|rate|429|503|500|aborted|timed out|timeout/i.test(e.message);
const isRetired = e => /no longer available|not found|deprecated/i.test(e.message);

// Ask Google which models this key can use, so we can fall back to another one
let modelCache = null;
async function availableModels() {
  if (modelCache) return modelCache;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": KEY() }, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    modelCache = (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name.replace(/^models\//, ""))
      .filter(n => /flash|pro/i.test(n) && !/tts|image|audio|live|embedding|exp|preview-tts/i.test(n));
  } catch { modelCache = []; }
  return modelCache;
}

async function callGemini(parts, json = true, timeoutMs = 45000, schema = null) {
  const tried = new Set();
  const extra = (process.env.GEMINI_FALLBACK_MODELS || "").split(",").map(x => x.trim()).filter(Boolean);
  let lastErr;
  for (let round = 0; round < 3; round++) {
    const model = MODEL();
    tried.add(model);
    // 1) retry the same model a few times when Google is busy
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await callOnce(parts, json, timeoutMs, model, schema); }
      catch (e) {
        lastErr = e;
        if (isBusy(e) && attempt < (/timed out/.test(e.message) ? 0 : 2)) { console.warn(`${model} busy, retrying (${attempt + 1})...`); await sleep(1200 * (attempt + 1)); continue; }
        break;
      }
    }
    // 2) switch to another model (one Google suggested, one from .env, or one this key can use)
    if (!isBusy(lastErr) && !isRetired(lastErr)) throw lastErr;
    const suggested = (lastErr.message.match(/models\/([a-z0-9.\-]+)/gi) || []).map(x => x.replace(/^models\//i, ""));
    const pool = [...suggested, ...extra, ...(await availableModels()).sort((a, b) => /flash/.test(b) - /flash/.test(a))];
    const next = pool.find(m => !tried.has(m));
    if (!next) break;
    console.warn(`Switching model: ${model} -> ${next}`);
    modelOverride = next;
  }
  throw lastErr;
}

let thinkingOk = true;
async function callOnce(parts, json, timeoutMs, model, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const generationConfig = { temperature: 0 };
    if (json) generationConfig.responseMimeType = "application/json";
    if (json && schema) generationConfig.responseSchema = schema;
    if (thinkingOk) generationConfig.thinkingConfig = /gemini-2/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: "low" };
    const r = await fetch(url, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY() },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig })
    });
    const j = await r.json();
    if (!r.ok) {
      // some models reject responseSchema -> retry once without it
      if (thinkingOk && r.status === 400 && /thinking/i.test(j.error?.message || "")) {
        console.warn(`${model} doesn't support the thinking setting, retrying without it`);
        thinkingOk = false;
        return callOnce(parts, json, timeoutMs, model, schema);
      }
      if (schema && r.status === 400 && /schema|response_schema|responseSchema|Invalid JSON payload/i.test(j.error?.message || "")) {
        console.warn(`${model} rejected the schema, retrying without it`);
        return callOnce(parts, json, timeoutMs, model, null);
      }
      throw new Error(j.error?.message || `Gemini HTTP ${r.status}`);
    }
    const cand = j.candidates?.[0];
    if (!cand) throw new Error("Gemini returned no answer" + (j.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ""));
    const text = (cand.content?.parts || []).filter(p => !p.thought && typeof p.text === "string").map(p => p.text).join("");
    if (!text.trim()) throw new Error(`Gemini returned an empty answer (finishReason: ${cand.finishReason || "unknown"})`);
    return text;
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${model} timed out after ${timeoutMs / 1000}s`);
    throw e;
  } finally { clearTimeout(t); }
}

const EXTRACT_PROMPT = `You are a bank's invoice-verification assistant. Extract the fields from this invoice and return ONLY a JSON object with these keys:
business_name, abn, email, phone, website, invoice_number, invoice_date,
subtotal (number, ex GST), gst (number), total (number, inc GST), deposit (number, 0 if none), amount_due (number - the balance the customer must pay),
account_name, bsb, account_number, reference,
bank_change_notice (true if the invoice says bank/payment details have changed),
urgency_language (true if it pressures the customer to pay immediately),
tamper_signs (array of short strings describing visual signs of editing, e.g. "payment details section uses a different font"; [] if none).
Use "" for missing text fields and 0 for missing numbers. Do not invent values.`;

const FIELDS = ["business_name","abn","email","phone","website","invoice_number","invoice_date","subtotal","gst","total","deposit","amount_due","account_name","bsb","account_number","reference","bank_change_notice","urgency_language","tamper_signs"];
const NUMERIC = ["subtotal","gst","total","deposit","amount_due"];
const SCHEMA = {
  type: "OBJECT",
  properties: Object.fromEntries(FIELDS.map(f => [f,
    f === "tamper_signs" ? { type: "ARRAY", items: { type: "STRING" } } :
    NUMERIC.includes(f) ? { type: "NUMBER" } :
    ["bank_change_notice","urgency_language"].includes(f) ? { type: "BOOLEAN" } : { type: "STRING" }])),
  required: FIELDS
};
// Other names models sometimes use for the same field
const SYNONYMS = {
  business_name: ["businessname","company","companyname","supplier","suppliername","vendor","vendorname","seller","from","issuer"],
  abn: ["abnnumber","australianbusinessnumber"],
  invoice_number: ["invoiceno","invoicenum","invoiceid","invoice"],
  amount_due: ["balancedue","amountpayable","totaldue","balance","amounttopay"],
  account_name: ["accountholder","accountholdername","payeename","beneficiaryname"],
  bsb: ["bsbnumber","banksb"],
  account_number: ["accountno","accountnum","acc","accno","bankaccountnumber"],
  subtotal: ["subtotalexgst","subtotalexclgst","amountexgst","net"],
  gst: ["tax","gstamount","taxamount"],
  total: ["totalincgst","invoicetotal","grandtotal","totalamount"],
  reference: ["paymentreference","ref"],
  tamper_signs: ["tampering","tampersigns","editsigns"]
};
const k = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function flatten(o, out = {}) {
  for (const [key, v] of Object.entries(o || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, out);
    else if (!(k(key) in out)) out[k(key)] = v;
  }
  return out;
}

function parseLoose(text) {
  let t = text.replace(/```(json)?/gi, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("AI reply wasn't valid JSON");
}

function normalise(raw) {
  let o = Array.isArray(raw) ? raw[0] : raw;
  const flat = flatten(o);
  const out = {};
  for (const f of FIELDS) {
    const keys = [k(f), ...(SYNONYMS[f] || [])];
    const hit = keys.find(x => x in flat && flat[x] !== null && flat[x] !== "");
    out[f] = hit ? flat[hit] : (o && Array.isArray(o[f]) ? o[f] : undefined);
  }
  for (const f of NUMERIC) out[f] = num(out[f]);
  out.amount_due = out.amount_due || (out.total ? out.total - out.deposit : 0);
  for (const f of ["bank_change_notice","urgency_language"]) out[f] = out[f] === true || String(out[f]).toLowerCase() === "true";
  out.tamper_signs = Array.isArray(out.tamper_signs) ? out.tamper_signs.filter(Boolean) : (out.tamper_signs ? [String(out.tamper_signs)] : []);
  for (const f of FIELDS) if (out[f] === undefined || out[f] === null) out[f] = "";
  return out;
}

async function extractInvoice(buffer, mime, debug = false) {
  const text = await callGemini([{ text: EXTRACT_PROMPT }, { inline_data: { mime_type: mime, data: buffer.toString("base64") } }], true, 60000, SCHEMA);
  console.log(`[AI raw reply · ${MODEL()}]`, text.slice(0, 600));
  const parsed = parseLoose(text);
  const fields = normalise(parsed);
  const found = FIELDS.filter(f => fields[f] !== "" && fields[f] !== 0 && fields[f] !== false && !(Array.isArray(fields[f]) && !fields[f].length));
  console.log(`[AI extracted ${found.length}/${FIELDS.length} fields]`, found.join(", "));
  if (found.length < 3) throw new Error("AI couldn't find the invoice details in this image (is it clear and the right way up?)");
  return debug ? { fields, raw: text, model: MODEL() } : fields;
}

async function explain(level, checks, fields) {
  const prompt = `You are "Invoice Check", a fraud-prevention assistant inside a business banking app. A business customer is about to pay a supplier invoice.
Rule-based verdict: ${level.toUpperCase()} (green = safe, amber = confirm with the supplier first, red = likely scam, payment stopped).
Invoice: ${JSON.stringify({ business: fields.business_name, abn: fields.abn, amount: fields.amount_due, bsb: fields.bsb, account: fields.account_number, account_name: fields.account_name, email: fields.email, notes: { bank_change_notice: fields.bank_change_notice, urgency_language: fields.urgency_language, tamper_signs: fields.tamper_signs } })}
Check results: ${JSON.stringify(checks.map(c => ({ check: c.title, result: c.status, detail: c.detail })))}
Return JSON: {"summary": "2-3 short plain-English sentences for the customer: what we found and exactly what to do next", "risk": "low" | "medium" | "high", "reasons": ["short reason", ...]}
"risk" is YOUR independent judgement of scam risk, looking at the combination of signals (e.g. invoice-redirection, impersonation, urgency, mule accounts, split payments).
Never mention internal investigations or suspicious matter reports. For amber, tell them to call the supplier on a number from the business register or their website, not the invoice. No markdown.`;
  const text = await callGemini([{ text: prompt }], true, 20000);
  const o = parseLoose(text);
  return { summary: String(o.summary || "").trim(), risk: ["low", "medium", "high"].includes(o.risk) ? o.risk : "low", reasons: Array.isArray(o.reasons) ? o.reasons.slice(0, 4) : [] };
}

module.exports = { enabled, extractInvoice, explain, model: MODEL };
