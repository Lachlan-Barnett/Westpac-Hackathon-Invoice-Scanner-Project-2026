// Usage limits, so a public link can't use up the Gemini quota.
//  - per visitor (IP address): a number of uses per hour for each kind of request
//  - for the whole app: a number of Gemini calls per day (GEMINI_DAILY_LIMIT)
// Counts are kept in memory, so they reset when the server restarts.
const HOUR = 3600000;
const PER_HOUR = {
  read: () => Number(process.env.SCANS_PER_HOUR) || 30,   // invoice reads (Gemini)
  check: () => 150,                                        // Invoice Checks (Gemini risk review)
  test: () => 10,                                          // "Test Gemini key"
  email: () => Number(process.env.EMAILS_PER_SENDER_PER_DAY) || 20  // per email sender, per day (see below)
};
const hits = new Map(); // "kind|who" -> [timestamps]
let day = "", aiToday = 0;

const dailyLimit = () => Number(process.env.GEMINI_DAILY_LIMIT) || 500;
function rollDay() { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; aiToday = 0; } }

// true if allowed (and counts it). kind "email" counts per day instead of per hour.
function allow(kind, who) {
  const now = Date.now(), win = kind === "email" ? 24 * HOUR : HOUR;
  const key = kind + "|" + who, list = (hits.get(key) || []).filter(t => now - t < win);
  if (list.length >= PER_HOUR[kind]()) { hits.set(key, list); return false; }
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < 24 * HOUR)) hits.delete(k);
  return true;
}
// Gemini calls for the whole app today
function aiAllowed() { rollDay(); return aiToday < dailyLimit(); }
function aiUsed(n = 1) { rollDay(); aiToday += n; }
function status() { rollDay(); return { aiToday, aiDailyLimit: dailyLimit(), scansPerHour: PER_HOUR.read(), emailsPerSenderPerDay: PER_HOUR.email() }; }

// Express middleware: 429 when a visitor goes over the hourly limit for this kind of request
const perVisitor = (kind, message) => (req, res, next) => {
  if (allow(kind, req.ip || req.socket.remoteAddress || "?")) return next();
  res.status(429).json({ ok: false, error: message || "You've reached the limit for now. Please try again in an hour." });
};

module.exports = { allow, aiAllowed, aiUsed, status, perVisitor };
