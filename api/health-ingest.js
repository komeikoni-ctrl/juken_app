// ============================================================
// 睡眠データの受け口（第3弾 70 パイロット / Vercel Functions 専用）
// ------------------------------------------------------------
// Vercel からは Apple ヘルスケアに直接触れないため、iPhone の
// ショートカット（ヘルスケア → HTTP リクエスト）から睡眠データを
// 受け取り、Firestore live/healthData に保存する受け口。
// 認可: 環境変数 HEALTH_TOKEN と一致するトークンが必須
// （Authorization: Bearer または x-health-token ヘッダー）。
// 受け付ける形: {date:'YYYY-MM-DD', hours:7.5, bed:'23:40', wake:'07:10'}
// または {entries:[{...}, ...]} の一括。保存は直近120日分まで。
// ============================================================
const crypto = require('crypto');
const lib = require('./_pushlib');

function tokenOk(req) {
  const expected = process.env.HEALTH_TOKEN || '';
  if (!expected) return false;
  const h = req.headers || {};
  const auth = h.authorization || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : (h['x-health-token'] || '');
  if (!given || given.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected)); } catch (e) { return false; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total <= 64 * 1024) chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// 1件を検証して保存用の形に整える。駄目なら null（純粋関数）
function sanitizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const date = String(e.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hours = Number(e.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return null;
  const out = { hours: Math.round(hours * 100) / 100 };
  if (e.bed != null && TIME_RE.test(String(e.bed))) out.bed = String(e.bed);
  if (e.wake != null && TIME_RE.test(String(e.wake))) out.wake = String(e.wake);
  return { date, entry: out };
}

// 既存 days に entries をマージし、直近 keep 日だけ残す（純粋関数）
function mergeDays(days, entries, keep) {
  const out = { ...(days && typeof days === 'object' ? days : {}) };
  for (const { date, entry } of entries) out[date] = { ...entry, updatedAt: new Date().toISOString() };
  const keys = Object.keys(out).sort();
  while (keys.length > (keep || 120)) delete out[keys.shift()];
  return out;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return lib.sendJson(res, 405, { error: 'POST only' });
    if (!tokenOk(req)) return lib.sendJson(res, 401, { error: 'unauthorized' });
    let raw = await readBody(req).catch(() => '');
    if (!raw && req.body) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return lib.sendJson(res, 400, { error: 'invalid JSON' }); }
    const list = Array.isArray(body.entries) ? body.entries : [body];
    const entries = list.map(sanitizeEntry).filter(Boolean);
    if (!entries.length) return lib.sendJson(res, 400, { error: 'no valid entries' });
    const doc = await lib.fsGetJson(lib.HEALTH_DATA_DOC, 'data', { days: {} });
    doc.days = mergeDays(doc.days, entries, 120);
    doc.updatedAt = new Date().toISOString();
    await lib.fsSetJson(lib.HEALTH_DATA_DOC, 'data', doc);
    return lib.sendJson(res, 200, { ok: true, saved: entries.length, dates: entries.map(e => e.date) });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 15 };
module.exports.helpers = { sanitizeEntry, mergeDays };
