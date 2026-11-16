// Small shared helpers
const digits = s => String(s ?? "").replace(/\D/g, "");
const num = v => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };
const money = n => "$" + Number(n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAbn = a => { const d = digits(a); return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : String(a ?? ""); };
const norm = s => String(s || "").toUpperCase().replace(/\b(PTY|LTD|LIMITED|PROPRIETARY|THE|CO|INC|TRADING AS|T\/A)\b/g, "").replace(/[^A-Z0-9]/g, "");
function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const similar = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return 0; return 1 - lev(x, y) / Math.max(x.length, y.length); };
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const lowerFirst = t => /^[A-Z]{2}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
function ageText(days) { return days < 60 ? `${days} days` : days < 730 ? `${Math.round(days / 30)} months` : `${Math.floor(days / 365.25)} years`; }

// Official ATO ABN checksum
function abnValid(abn) {
  const d = digits(abn).split("").map(Number);
  if (d.length !== 11) return false;
  d[0] -= 1;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  return d.reduce((s, x, i) => s + x * w[i], 0) % 89 === 0;
}

module.exports = { digits, num, money, fmtAbn, norm, lev, similar, cap, lowerFirst, ageText, abnValid };
