// Keeps the bank database when the host restarts the app.
// Free hosts (like Render's free plan) wipe local files on every restart, so data/bank.sqlite would go back to the sample data.
// If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set (free at https://upstash.com), a copy of the database
// is saved there after every change and loaded again when the app starts.
const fs = require("fs");

const URL_ = () => (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
const TOKEN = () => (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const KEY = () => (process.env.DB_BACKUP_KEY || "invoice-checker-bank-sqlite").trim();
const enabled = () => !!(URL_() && TOKEN());
let state = { last: null, error: null, restored: false };

async function call(method, path, body) {
  const r = await fetch(`${URL_()}/${path}`, { method, headers: { Authorization: `Bearer ${TOKEN()}` }, body, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Upstash HTTP ${r.status}`);
  return j.result;
}

// Before the database opens: replace the local file with the saved copy (if there is one)
async function restore(file) {
  if (!enabled()) return false;
  try {
    const b64 = await call("GET", `get/${encodeURIComponent(KEY())}`);
    if (!b64) { console.log("  Database backup: none saved yet (the first change will create it)"); return false; }
    fs.writeFileSync(file, Buffer.from(b64, "base64"));
    state.restored = true;
    console.log(`  Database backup: restored from Upstash (${Math.round(b64.length * 0.75 / 1024)} KB)`);
    return true;
  } catch (e) { state.error = e.message; console.warn("  Database backup: couldn't restore, using the local file:", e.message); return false; }
}

// After every save: upload a copy (bundled, so a burst of changes is one upload)
let timer = null, pending = null;
function backup(bytes) {
  if (!enabled()) return;
  pending = bytes; clearTimeout(timer);
  timer = setTimeout(flush, 1500);
}
async function flush() {
  if (!pending) return;
  const bytes = pending; pending = null; clearTimeout(timer);
  try { await call("POST", `set/${encodeURIComponent(KEY())}`, Buffer.from(bytes).toString("base64")); state.last = new Date().toISOString(); state.error = null; }
  catch (e) { state.error = e.message; console.warn("Database backup failed:", e.message); }
}

const status = () => ({ enabled: enabled(), ...state });
module.exports = { enabled, restore, backup, flush, status };
