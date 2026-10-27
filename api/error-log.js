// ============================================================
// アプリのエラー自動検知の受け口（Vercel Functions 専用）
// ------------------------------------------------------------
// アプリ（11-boot.js の ErrorReport）が window.onerror /
// unhandledrejection を捕まえたときに、Vercel オリジンでのみ
// ここへ送る。送るのはメッセージ・発生箇所・バージョン・ページ
// 名だけで、入力内容や個人データは含めない。
// 保存先は Firestore live/errorLog（直近50件）。悪用・肥大化
// 対策として、自サイト Origin 以外は拒否し、1日100件で打ち切る。
// ============================================================
const lib = require('./_pushlib');

const ALLOWED_ORIGINS = new Set([
  'https://juken-app-sigma.vercel.app',
  'https://komeikoni-ctrl.github.io'
]);
const VERCEL_ORIGIN_RE = /^https:\/\/juken-app(-[a-z0-9-]+)?\.vercel\.app$/;
const MAX_ENTRIES = 50;
const DAILY_CAP = 100;

function originAllowed(req) {
  const h = req.headers || {};
  const src = h.origin || h.referer || h.referrer || '';
  if (!src) return false;
  let origin;
  try { origin = new URL(src).origin; } catch (e) { return false; }
  return ALLOWED_ORIGINS.has(origin) || VERCEL_ORIGIN_RE.test(origin);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => { total += c.length; if (total > 16 * 1024) return; chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 受け取ったものを保存用の形に整える（純粋関数に近い形で切り出し、長さ制限をここで担保）
function sanitize(body, nowIso, day) {
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
  return {
    at: nowIso,
    day,
    type: clip(body?.type, 30) || 'error',
    message: clip(body?.message, 300),
    source: clip(body?.source, 200),
    version: clip(body?.version, 20),
    page: clip(body?.page, 40)
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return lib.sendJson(res, 405, { error: 'POST only' });
    if (!originAllowed(req)) return lib.sendJson(res, 403, { error: 'origin not allowed' });
    let raw = await readBody(req).catch(() => '');
    if (!raw && req.body) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return lib.sendJson(res, 400, { error: 'invalid JSON' }); }

    const nowIso = new Date().toISOString();
    const day = lib.todayJst();
    const entry = sanitize(body, nowIso, day);
    if (!entry.message) return lib.sendJson(res, 400, { error: 'message is required' });

    const entries = await lib.fsGetJson(lib.ERROR_LOG_DOC, 'entries', []);
    const list = Array.isArray(entries) ? entries : [];
    const todayCount = list.filter(e => e && e.day === day).length;
    if (todayCount >= DAILY_CAP) return lib.sendJson(res, 200, { ok: true, stored: false, reason: 'daily cap' });
    list.unshift(entry);
    await lib.fsSetJson(lib.ERROR_LOG_DOC, 'entries', list.slice(0, MAX_ENTRIES));
    return lib.sendJson(res, 200, { ok: true, stored: true });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};
