// ============================================================
// Web Push 送信エンドポイント（Vercel Functions 専用）
// ------------------------------------------------------------
// POST {test:true} … 設定画面の「テスト通知を送る」用。本文は
//   サーバー側で固定し、自サイト Origin からの呼び出しだけ許可。
// POST {title, body, url?, tag?} … 任意の通知。CRON_SECRET の
//   認可ヘッダーが必須（第三者が勝手に通知を送れないように）。
// 購読が無ければ何もせず正常終了する（実機購読は本人が後日）。
// ============================================================
const lib = require('./_pushlib');

const ALLOWED_ORIGINS = new Set([
  'https://juken-app-sigma.vercel.app',
  'https://komeikoni-ctrl.github.io'
]);
const VERCEL_ORIGIN_RE = /^https:\/\/juken-app(-[a-z0-9-]+)?\.vercel\.app$/;

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
    req.on('data', (c) => { total += c.length; if (total > 64 * 1024) return; chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return lib.sendJson(res, 405, { error: 'POST only' });
    let raw = await readBody(req).catch(() => '');
    if (!raw && req.body) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return lib.sendJson(res, 400, { error: 'invalid JSON' }); }

    let payload;
    if (body.test === true) {
      // テスト通知は本文固定＋自サイトからの呼び出しのみ
      if (!originAllowed(req)) return lib.sendJson(res, 403, { error: 'origin not allowed' });
      payload = {
        title: '🔔 テスト通知',
        body: '受験管理アプリ2027のプッシュ通知が届いています。これが見えれば設定完了です。',
        url: '/', tag: 'juken-test'
      };
    } else {
      if (!lib.cronAuthorized(req)) return lib.sendJson(res, 401, { error: 'unauthorized' });
      const title = String(body.title || '').slice(0, 80);
      const text = String(body.body || '').slice(0, 300);
      if (!title || !text) return lib.sendJson(res, 400, { error: 'title and body are required' });
      payload = { title, body: text, url: typeof body.url === 'string' ? body.url.slice(0, 300) : '/', tag: String(body.tag || 'juken').slice(0, 40) };
    }

    const r = await lib.sendPushToAll(payload);
    return lib.sendJson(res, 200, { ok: true, ...r });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};
