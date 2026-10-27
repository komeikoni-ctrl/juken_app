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

// 監視対象（いずれも実際にアクセスし、タイトルまで確認した公式の入試情報トップ）
// 同志社: 本体サイトの「入学案内」、立命館: 入試情報サイト、近畿: 入試情報サイト「いくぞ！近大」
const TARGETS = [
  { id: 'doshisha', name: '同志社大学', url: 'https://www.doshisha.ac.jp/admission/' },
  { id: 'ritsumei', name: '立命館大学', url: 'https://admission.ritsumei.ac.jp/' },
  { id: 'kindai',   name: '近畿大学',   url: 'https://kindai.jp/' },
  // 入試結果データのページ（2026-10-27 に実在とタイトルを確認済み）。
  // 志願者速報そのものではないが、新しい結果データの掲載を検知できる。
  { id: 'ritsumei-result', name: '立命館大学（入試結果データ）', url: 'https://admission.ritsumei.ac.jp/admission/general/result.html' },
  { id: 'kindai-results',  name: '近畿大学（入試結果）',       url: 'https://kindai.jp/exam/results/' }
];
// 志願者速報ページの出現チェック（項目24）: 2027年度入試の速報ページは
// 2026-10-27 時点で3大学とも未出現（トップ・学部入試ページにリンクなし、
// を実アクセスで確認）。推測URLは監視に入れず、代わりに各大学の入試
// トップのリンクを毎日走査し、「出願状況／志願者速報」等へのリンクが
// 新しく出現したら知らせる。出現状況は live/admWatch の sokuho に出す。
const SOKUHO_TARGET_IDS = ['doshisha', 'ritsumei', 'kindai'];
const SOKUHO_KEYWORDS = /(出願状況|志願者速報|志願状況|出願速報|志願者数)/;

function scanSokuhoLinks(html, baseUrl) {
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!SOKUHO_KEYWORDS.test(text)) continue;
    try { out.push({ href: new URL(m[1], baseUrl).toString(), text: text.slice(0, 60) }); } catch (e) { /* 相対解決できないものは捨てる */ }
  }
  return out;
}

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
    if (!state.sokuho || typeof state.sokuho !== 'object') state.sokuho = {};
    const updates = await lib.fsGetJson(lib.WATCH_DOC, 'updates', []);
    const nowIso = new Date().toISOString();
    const results = [];
    let changedCount = 0;
    const sokuhoStatus = {};

    for (const t of TARGETS) {
      try {
        const html = await fetchPage(t.url);
        // 志願者速報リンクの出現チェック（主要3対象のみ・生HTMLを走査）
        if (SOKUHO_TARGET_IDS.includes(t.id)) {
          const links = scanSokuhoLinks(html, t.url);
          const prevHrefs = state.sokuho[t.id];
          sokuhoStatus[t.id] = { found: links.length, links: links.map(l => l.href) };
          if (Array.isArray(prevHrefs)) {
            for (const l of links) {
              if (prevHrefs.includes(l.href)) continue;
              updates.unshift({
                id: 's' + Date.now() + '-' + t.id,
                kind: 'sokuho',
                uni: t.name, url: l.href, at: nowIso,
                snippet: '「' + l.text + '」へのリンクが入試ページに出現しました（志願者速報の掲載が始まった可能性があります）',
                read: false
              });
              changedCount++;
              results.push({ id: t.id, status: 'sokuho-appeared', href: l.href });
            }
          }
          state.sokuho[t.id] = links.map(l => l.href);
        }
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
      const anyFound = Object.values(sokuhoStatus).some(s => s.found > 0);
      await lib.fsSetField(lib.WATCH_DOC, 'sokuho', JSON.stringify({
        status: anyFound ? 'found' : 'pending',
        checkedAt: nowIso,
        perUni: sokuhoStatus,
        note: anyFound ? '志願者速報へのリンクが出現しています' : '志願者速報ページは未出現（入試トップのリンク出現を監視中）'
      }));
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
    return lib.sendJson(res, 200, { ok: true, at: nowIso, results, changed: changedCount, sokuho: sokuhoStatus, push: pushResult });
  } catch (e) {
    return lib.sendJson(res, 500, { error: 'internal error' });
  }
};

module.exports.config = { maxDuration: 60 };
