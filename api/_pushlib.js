// ============================================================
// Web Push / Firestore 共有ライブラリ（Vercel Functions 専用）
// ------------------------------------------------------------
// 先頭が _ のファイルは Vercel のエンドポイントにならない
// （api/gemini.js と同じく、Pages では静的ファイルとして
// 公開されるだけで実行はされない）。
//
// Web Push は npm 依存を増やさないため、RFC 8291（aes128gcm
// コンテンツ暗号化）と RFC 8292（VAPID）を Node 標準の
// crypto だけで実装している。
//
// Firestore への読み書きは、お金タブの live/money と同じ
// REST 方式（アプリが読む live/* ドキュメント郡と同じ流儀）。
// ============================================================
const crypto = require('crypto');

const FS_BASE = 'https://firestore.googleapis.com/v1/projects/juken2027-63058/databases/(default)/documents';
const PUSH_SUBS_DOC = 'live/pushSubs';   // fields.subs = 購読情報の JSON 文字列
const PUSH_STATE_DOC = 'live/pushState'; // fields.notifyLog = 送信済み記録の JSON 文字列
const WATCH_DOC = 'live/admWatch';       // fields.state（サーバー用）/ fields.updates（アプリ表示用）
const AI_USAGE_DOC = 'live/aiUsage';     // fields.usage = 日次・モデル別の利用量 JSON
const ERROR_LOG_DOC = 'live/errorLog';   // fields.entries = サーバー受信エラーの JSON 配列
const BACKUPS_INDEX_DOC = 'live/backups'; // fields.days = バックアップ日次の索引 JSON
const HEALTH_DOC = 'live/health';        // fields.health = 健全性チェック結果 JSON
const MONEY_DOC = 'live/money';          // fields.money = お金データ JSON（外部チェッカーが書き込み）
const FEEDS_DOC = 'live/feeds';          // 16-live.js の中継ドキュメント
const PAYPAY_IMPORT_DOC = 'live/paypayImport'; // fields.data = アプリから取り込んだ PayPay CSV データセット群
const HEALTH_DATA_DOC = 'live/healthData';     // fields.data = 睡眠データ（70 パイロット）
const ESSAY_QUEUE_DOC = 'live/essayQueue';     // fields.data = 添削キュー（15）
const OCR_DOCS_DOC = 'live/ocrDocs';           // fields.data = OCR 文書（93 パイロット）
const PROFILE_DOC = 'appData/perfect_sync_data_2027'; // プロフィール本体

// ---------- base64url ----------
const b64uEncode = (buf) => Buffer.from(buf).toString('base64url');
const b64uDecode = (s) => Buffer.from(String(s), 'base64url');

// ---------- Firestore REST（live/money と同じ方式） ----------
async function fsGetDoc(path) {
  const res = await fetch(`${FS_BASE}/${path}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('firestore get failed: ' + res.status);
  return res.json();
}

async function fsSetField(path, field, stringValue) {
  const url = `${FS_BASE}/${path}?updateMask.fieldPaths=${encodeURIComponent(field)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [field]: { stringValue } } })
  });
  if (!res.ok) throw new Error('firestore patch failed: ' + res.status);
  return res.json();
}

// ドキュメントの JSON 文字列フィールドを読む（無ければ fallback）
async function fsGetJson(path, field, fallback) {
  try {
    const doc = await fsGetDoc(path);
    const s = doc?.fields?.[field]?.stringValue;
    if (!s) return fallback;
    const v = JSON.parse(s);
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}

// オブジェクトを JSON 文字列フィールドとして書く
async function fsSetJson(path, field, obj) {
  return fsSetField(path, field, JSON.stringify(obj));
}

// ドキュメントを削除する（ローテーション用）。成否だけ返す
async function fsDeleteDoc(path) {
  try {
    const res = await fetch(`${FS_BASE}/${path}`, { method: 'DELETE' });
    return res.ok;
  } catch (e) { return false; }
}

// サブコレクションの先頭数件だけ読む（健全性チェックの「最終更新の目安」用）。
// 並び順は保証されないサンプルなので、updateTime の最大値を目安として使う。
async function fsSampleCollection(path, pageSize) {
  const res = await fetch(`${FS_BASE}/${path}?pageSize=${pageSize || 5}`, { cache: 'no-store' });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error('firestore list failed: ' + res.status);
  const j = await res.json();
  return Array.isArray(j.documents) ? j.documents : [];
}

// JST の今日を YYYY-MM-DD で返す
function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------- 購読情報 ----------
// 形: [{endpoint, keys:{p256dh, auth}}, ...]
async function getSubscriptions() {
  const v = await fsGetJson(PUSH_SUBS_DOC, 'subs', []);
  return Array.isArray(v) ? v.filter(s => s && s.endpoint && s.keys?.p256dh && s.keys?.auth) : [];
}
async function saveSubscriptions(list) {
  await fsSetField(PUSH_SUBS_DOC, 'subs', JSON.stringify(list));
}

// ---------- Cron 認可 ----------
// Vercel Cron は CRON_SECRET 環境変数を Authorization: Bearer で送る。
// 手動実行用に x-cron-secret ヘッダーも受ける。未設定なら常に拒否（閉じる）。
function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const h = req.headers || {};
  const auth = h.authorization || '';
  if (auth === 'Bearer ' + secret) return true;
  if (h['x-cron-secret'] === secret) return true;
  return false;
}

// ---------- VAPID（RFC 8292） ----------
function vapidKeys() {
  const privB64 = process.env.VAPID_PRIVATE_KEY || '';
  if (!privB64) return null;
  const d = b64uDecode(privB64);
  if (d.length !== 32) return null;
  // 秘密値だけでは JWK として鍵を作れないので、公開点を ECDH で導出してから作る
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pubRaw = ecdh.getPublicKey(null, 'uncompressed'); // 0x04 || X || Y
  const x = b64uEncode(pubRaw.subarray(1, 33));
  const y = b64uEncode(pubRaw.subarray(33, 65));
  const privateKey = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: privB64, x, y }, format: 'jwk'
  });
  return { privateKey, publicRaw: pubRaw, publicB64: b64uEncode(pubRaw) };
}

function vapidAuthHeader(endpoint) {
  const keys = vapidKeys();
  if (!keys) return null;
  const aud = new URL(endpoint).origin;
  const header = b64uEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64uEncode(Buffer.from(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: process.env.VAPID_SUBJECT || 'mailto:komeikoni@icloud.com'
  })));
  const sig = crypto.sign('sha256', Buffer.from(header + '.' + payload), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  const jwt = header + '.' + payload + '.' + b64uEncode(sig);
  return { header: `vapid t=${jwt}, k=${keys.publicB64}`, publicRaw: keys.publicRaw };
}

// ---------- ペイロード暗号化（RFC 8291, aes128gcm） ----------
function hkdfExpand(prk, info, length) {
  const out = [];
  let prev = Buffer.alloc(0);
  let n = 0;
  for (let i = 1; n < length; i++) {
    prev = crypto.createHmac('sha256', prk).update(Buffer.concat([prev, info, Buffer.from([i])])).digest();
    out.push(prev); n += prev.length;
  }
  return Buffer.concat(out).subarray(0, length);
}
const hkdf = (ikm, salt, info, length) => {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return hkdfExpand(prk, info, length);
};

// 1件の購読へ通知を送る。成功で true、購読切れ（404/410）で 'gone'、他は false。
async function sendPush(sub, payloadObj) {
  const auth = vapidAuthHeader(sub.endpoint);
  if (!auth) return false;
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const body = encryptPayloadWithKey(ecdh, b64uDecode(sub.keys.p256dh), b64uDecode(sub.keys.auth), JSON.stringify(payloadObj));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth.header,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400'
    },
    body
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.status >= 200 && res.status < 300;
}

function encryptPayloadWithKey(ecdh, uaPubRaw, authSecret, plaintext) {
  const shared = ecdh.computeSecret(uaPubRaw);
  const serverPub = ecdh.getPublicKey(null, 'uncompressed');
  const salt = crypto.randomBytes(16);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPubRaw, serverPub]);
  const ikm = hkdf(shared, authSecret, info, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const record = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub, ct]);
}

// 全購読へ送信し、切れた購読を取り除く。戻り値 {sent, gone, total}
async function sendPushToAll(payloadObj) {
  const subs = await getSubscriptions();
  let sent = 0, gone = 0;
  const keep = [];
  for (const sub of subs) {
    try {
      const r = await sendPush(sub, payloadObj);
      if (r === 'gone') { gone++; continue; }
      if (r) sent++;
      keep.push(sub);
    } catch (e) { keep.push(sub); }
  }
  if (gone > 0) { try { await saveSubscriptions(keep); } catch (e) { /* 次回に任せる */ } }
  return { sent, gone, total: subs.length };
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

module.exports = {
  FS_BASE, PUSH_SUBS_DOC, PUSH_STATE_DOC, WATCH_DOC,
  AI_USAGE_DOC, ERROR_LOG_DOC, BACKUPS_INDEX_DOC, HEALTH_DOC, MONEY_DOC, FEEDS_DOC, PROFILE_DOC,
  PAYPAY_IMPORT_DOC, HEALTH_DATA_DOC, ESSAY_QUEUE_DOC, OCR_DOCS_DOC,
  b64uEncode, b64uDecode,
  fsGetDoc, fsSetField, fsGetJson, fsSetJson, fsDeleteDoc, fsSampleCollection,
  todayJst,
  getSubscriptions, saveSubscriptions,
  cronAuthorized, sendPush, sendPushToAll, sendJson
};
