// ============================================================
// 志望校 入試情報ページの更新チェック（Vercel Cron 専用）
// ------------------------------------------------------------
// 毎日 JST 8:05（= 23:05 UTC）に Vercel Cron から呼ばれる。
// 各大学の公式「入学案内」トップページを取得し、正規化した
// 本文テキストのハッシュを前回値（Firestore live/admWatch）と
// 比較。初回はベースライン保存のみ（通知しない）。変更を検知
// したら Firestore に記録し（アプリのホームにカード表示）、
// 購読があれば Web Push でも知らせる。
// 認可: cron-notify と同じ CRON_SECRET。
// ============================================================
const crypto = require('crypto');
const lib = require('./_pushlib');

// 監視対象（いずれも実際にアクセスして確認した公式の入学案内トップ）
const TARGETS = [
  { id: 'doshisha', name: '同志社大学', url: 'https://www.doshisha.ac.jp/admission/' },
  { id: 'ritsumei', name: '立命館大学', url: 'https://www.ritsumei.ac.jp/admission/' },
  { id: 'kindai',   name: '近畿大学',   url: 'https://www.kindai.ac.jp/admission/' }
];

// HTML → 比較用の本文テキスト。
// スクリプト・スタイル・コメント・タグを除き、実体参照を戻し、
// 空白を圧縮する。さらに毎回変わりやすい揮発要素（現在時刻の
// 表示やアクセスカウンタ相当の長い数字列）を落として誤検知を減らす。
function normalize(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
       .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\d{1,2}:\d{2}(:\d{2})?\s*(現在|時点)/g, ' '); // 時刻表示
  s = s.replace(/\b\d{6,}\b/g, ' '); // カウンタ・長いID相当
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// 旧テキストと新テキストで最初に食い違う場所の周辺（新側）を抜き出す
function diffSnippet(oldText, newText) {
  const a = oldText || '', b = newText || '';
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  const start = Math.max(0, i - 30);
  return b.slice(start, start + 140);
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'ja'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('fetch failed: ' + res.status);
  return res.text();
}

module.exports = async (req, res) => {
  try {
    if (!lib.cronAuthorized(req)) return lib.sendJson(res, 401, { error: 'unauthorized' });

    const state = await lib.fsGetJson(lib.WATCH_DOC, 'state', { unis: {} });
    if (!state.unis) state.unis = {};
    const updates = await lib.fsGetJson(lib.WATCH_DOC, 'updates', []);
    const nowIso = new Date().toISOString();
    const results = [];
    let changedCount = 0;

    for (const t of TARGETS) {
      try {
        const html = await fetchPage(t.url);
        const text = normalize(html);
        const hash = sha256(text);
        const prev = state.unis[t.id];
        if (!prev || !prev.hash) {
          // 初回はベースライン保存のみ（通知しない）
          state.unis[t.id] = { hash, text, checkedAt: nowIso };
          results.push({ id: t.id, status: 'baseline' });
          continue;
        }
        state.unis[t.id] = { hash, text, checkedAt: nowIso };
        if (prev.hash === hash) {
          results.push({ id: t.id, status: 'same' });
          continue;
        }
        const snippet = diffSnippet(prev.text, text);
        const entry = {
          id: 'w' + Date.now() + '-' + t.id,
          uni: t.name, url: t.url, at: nowIso,
          snippet, read: false
        };
        updates.unshift(entry);
        changedCount++;
        results.push({ id: t.id, status: 'changed', snippet: snippet.slice(0, 60) });
      } catch (e) {
        results.push({ id: t.id, status: 'error', error: String(e && e.message || e) });
      }
    }

    try {
      await lib.fsSetField(lib.WATCH_DOC, 'state', JSON.stringify(state));
      if (changedCount) await lib.fsSetField(lib.WATCH_DOC, 'updates', JSON.stringify(updates.slice(0, 20)));
    } catch (e) { /* 保存失敗は次回に持ち越し */ }

    let pushResult = null;
    if (changedCount) {
      const names = [...new Set(results.filter(r => r.status === 'changed').map(r => TARGETS.find(t => t.id === r.id).name))];
      pushResult = await lib.sendPushToAll({
        title: '🎓 入試情報が更新されました',
        body: names.join('・') + ' の入試ページに変更を検知しました。アプリのホームで内容を確認できます。',
        url: '/', tag: 'juken-adm-watch'
      });
    }
    return lib.sendJson(res, 200, { ok: true, at: nowIso, results, changed: changedCount, push: pushResult });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 60 };
