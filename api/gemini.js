// ============================================================
// Gemini API 中継（Vercel Functions 専用）
// ------------------------------------------------------------
// ブラウザから直接 Gemini API を叩く代わりに、この関数が
// 環境変数 GEMINI_API_KEY を使って Google へ転送する。
// Vercel 上ではアプリ側が APIキーなしで AI 機能を使える。
//
// 公開先は Vercel に一本化済み（GitHub Pages / Firebase Hosting は転送ページのみ）。
// 中継が無い環境（ローカルの静的サーバーなど）では、アプリ側は
// /api/gemini への POST が 404/405 になることで中継なしと判定し、
// 端末に保存したキーでの直接呼び出しにフォールバックする。
//
// ⚠️ 悪用対策は「無差別な悪用を防ぐ」ためのもので、完全な防御ではない:
//  - Origin / Referer が自サイトのものだけ許可（ただしヘッダーは詐称可能）
//  - モデルは許可リストのみ、ボディサイズと出力トークンに上限
// 本命の防御は Google 側の API キー制限とプリペイド残高の上限。
// ============================================================

const lib = require('./_pushlib');

// アプリ側 AVAILABLE_MODELS（public/js/03-ai.js）と揃えること
const ALLOWED_MODELS = ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash'];
// Vercel Functions のリクエスト上限（4.5MB）に収める
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;
// アプリの通常利用（最大 4096）の倍まで許可し、それ以上は切り詰める
const MAX_OUTPUT_TOKENS_CAP = 8192;

const ALLOWED_ORIGINS = new Set([
  'https://juken-app-sigma.vercel.app'
]);
// 自分たちの Vercel デプロイ（プレビュー等）のオリジン
const VERCEL_ORIGIN_RE = /^https:\/\/juken-app(-[a-z0-9-]+)?\.vercel\.app$/;

function originAllowed(req) {
  const h = req.headers || {};
  const src = h.origin || h.referer || h.referrer || '';
  if (!src) return false;
  let origin;
  try { origin = new URL(src).origin; } catch (e) { return false; }
  return ALLOWED_ORIGINS.has(origin) || VERCEL_ORIGIN_RE.test(origin);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('x-ai-proxy', '1');
  res.end(body);
}

function proxyError(res, status, code, message) {
  sendJson(res, status, { error: { message, status: code, proxy: true } });
}

// ============================================================
// AI利用量の集計（live/aiUsage）
// ------------------------------------------------------------
// 成功した生成（HTTP 200）の usageMetadata を日次・モデル別に
// 加算する。生成そのものを止めないため、記録は最大 1.2 秒だけ
// 待つ（通常は 0.2〜0.4 秒）。失敗しても応答には影響しない。
// 端末キーで直接呼んだ分は中継を通らないので数えられない。
// ============================================================
function extractUsageFromJson(text) {
  try {
    const j = JSON.parse(text);
    return j && j.usageMetadata ? j.usageMetadata : null;
  } catch (e) { return null; }
}
// SSE は各イベントに usageMetadata が入り、最終値が累計。最後に見つかったものを取る
function extractUsageFromSse(text) {
  let usage = null;
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const body = t.slice(5).trim();
    if (!body || body === '[DONE]') continue;
    try {
      const obj = JSON.parse(body);
      if (obj && obj.usageMetadata) usage = obj.usageMetadata;
    } catch (e) { /* 途中で切れた断片は無視 */ }
  }
  return usage;
}

async function recordUsage(model, usage) {
  const inTok = Number(usage?.promptTokenCount || 0);
  const outTok = Number(usage?.candidatesTokenCount || 0) + Number(usage?.thoughtsTokenCount || 0);
  const doc = await lib.fsGetJson(lib.AI_USAGE_DOC, 'usage', { days: {} });
  if (!doc.days || typeof doc.days !== 'object') doc.days = {};
  const day = lib.todayJst();
  if (!doc.days[day]) doc.days[day] = {};
  const cur = doc.days[day][model] || { calls: 0, in: 0, out: 0 };
  cur.calls += 1; cur.in += inTok; cur.out += outTok;
  doc.days[day][model] = cur;
  // 肥大化防止: 直近62日分だけ残す
  const keys = Object.keys(doc.days).sort();
  while (keys.length > 62) delete doc.days[keys.shift()];
  doc.updatedAt = new Date().toISOString();
  await lib.fsSetJson(lib.AI_USAGE_DOC, 'usage', doc);
}

// 記録を試みるが、応答を待たせすぎない（失敗・遅延は無視）
async function recordUsageQuiet(model, usage) {
  if (!usage) return;
  try {
    await Promise.race([
      recordUsage(model, usage),
      new Promise(r => setTimeout(r, 1200))
    ]);
  } catch (e) { /* 集計の失敗は生成に影響させない */ }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooBig = false;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) { const e = new Error('too large'); e.code = 'TOO_LARGE'; return reject(e); }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('x-ai-proxy', '1');
  try {
    if (req.method !== 'POST') return proxyError(res, 405, 'PROXY_METHOD', 'POST only');

    // 自サイト以外からの呼び出しは受け付けない
    if (!originAllowed(req)) return proxyError(res, 403, 'PROXY_ORIGIN', 'origin not allowed');

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) return proxyError(res, 503, 'PROXY_NOT_CONFIGURED', 'GEMINI_API_KEY is not set on the server');

    let raw;
    try { raw = await readBody(req); }
    catch (e) {
      if (e.code === 'TOO_LARGE') return proxyError(res, 413, 'PROXY_TOO_LARGE', 'request body too large');
      throw e;
    }
    // ランタイムが本文を先にパースしていた場合の保険
    if (!raw && req.body) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return proxyError(res, 400, 'PROXY_BAD_JSON', 'invalid JSON body'); }

    const model = String(body.model || '');
    if (!ALLOWED_MODELS.includes(model)) return proxyError(res, 400, 'PROXY_MODEL', 'model not allowed: ' + model);
    const payload = body.payload;
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.contents)) {
      return proxyError(res, 400, 'PROXY_BAD_PAYLOAD', 'payload.contents is required');
    }
    // 出力トークンの上限をキャップ（暴走コスト防止）
    if (payload.generationConfig && typeof payload.generationConfig.maxOutputTokens === 'number'
        && payload.generationConfig.maxOutputTokens > MAX_OUTPUT_TOKENS_CAP) {
      payload.generationConfig.maxOutputTokens = MAX_OUTPUT_TOKENS_CAP;
    }

    const method = body.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}`;
    let up;
    try {
      up = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return proxyError(res, 502, 'PROXY_UPSTREAM', 'failed to reach Gemini API');
    }

    // 上流のステータスと本文はそのまま返す（アプリ側のエラー分類を壊さない）
    res.statusCode = up.status;
    res.setHeader('x-ai-proxy', '1');
    const ct = up.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    if (body.stream) res.setHeader('Cache-Control', 'no-cache');
    if (!up.body) { res.end(); return; }
    const reader = up.body.getReader();
    // 利用量集計用に、応答のコピーを上限付きで集める（usageMetadata は末尾側に出る）
    const collected = [];
    let collectedBytes = 0;
    const COLLECT_CAP = 1024 * 1024;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      res.write(buf);
      if (collectedBytes < COLLECT_CAP) { collected.push(buf); collectedBytes += buf.length; }
    }
    // 利用量の記録は本文を流し終えてから（ストリーミング表示は妨げない）
    if (up.status === 200) {
      const text = Buffer.concat(collected).toString('utf8');
      const usage = body.stream ? extractUsageFromSse(text) : extractUsageFromJson(text);
      await recordUsageQuiet(model, usage);
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) proxyError(res, 500, 'PROXY_INTERNAL', 'proxy internal error');
    else { try { res.end(); } catch (_) { /* noop */ } }
  }
};

// AI の長文生成が Hobby 枠の既定上限で切れないように（最大60秒まで）
module.exports.config = { maxDuration: 60 };
