// ABN check: the LIVE Australian Business Register (when ABR_GUID is set) plus the bank's own business database.
const { digits } = require("./util");
const db = require("./db");

const enabled = () => !!(process.env.ABR_GUID || "").trim();

async function liveLookup(abn) {
  const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${abn}&callback=cb&guid=${encodeURIComponent(process.env.ABR_GUID.trim())}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const j = JSON.parse((await r.text()).replace(/^\s*cb\(/, "").replace(/\)\s*;?\s*$/, ""));
  if (j.Message) throw new Error(j.Message);
  if (!j.EntityName) return null;
  return {
    abn, entity_name: j.EntityName, trading_names: (j.BusinessName || []).join(", "), entity_type: j.EntityTypeName || "",
    abn_status: j.AbnStatus === "Active" ? "Active" : (j.AbnStatus || "Cancelled"), abn_registered: j.AbnStatusEffectiveFrom || null,
    gst_registered: j.Gst || null, state: j.AddressState, postcode: j.AddressPostcode
  };
}

// Returns the business record, merged from live ABR (authoritative) and the bank's database (contact details).
async function lookup(abnRaw) {
  const abn = digits(abnRaw);
  const local = db.get("SELECT * FROM businesses WHERE abn = ?", [abn]);
  if (enabled()) {
    try {
      const live = await liveLookup(abn);
      if (!live) return local ? { ...local, source: "db" } : null;   // demo businesses aren't on the real register
      return { ...(local || {}), ...live, trading_names: live.trading_names || local?.trading_names || "", industry: local?.industry,
               phone: local?.phone, email_domain: local?.email_domain, website: local?.website, source: "live" };
    } catch (e) { console.warn("Live ABN Lookup failed, using bank database:", e.message); }
  }
  return local ? { ...local, source: "db" } : null;
}

module.exports = { lookup, enabled };
