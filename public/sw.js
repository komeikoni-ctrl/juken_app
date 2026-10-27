// ============================================================
// Service Worker — オフライン対応とバージョン更新の通知
// デプロイのたびに js/version.js の APP_VERSION を上げること。
// 値が変わると新しい Service Worker として認識され、
// アプリ側に「新しいバージョンがあります」バナーが出る。
// ============================================================
// バージョンは js/version.js の1か所だけで管理する。importScripts したファイルの変更も
// Service Worker の更新チェックの対象になるので、version.js を上げるだけで新版として認識される。
// （以前は2か所を手で揃える必要があり、片方だけ上げると更新が配信されなかった）
importScripts('./js/version.js');
const SW_VERSION = APP_VERSION;
const CACHE = 'juken-' + SW_VERSION;

// 起動に必要な一式。ここが揃っていれば圏外でもアプリが開く
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './js/version.js',
  './js/00-core.js',
  './js/01-state.js',
  './js/02-db.js',
  './js/03-ai.js',
  './js/04-coach.js',
  './js/05-chat.js',
  './js/06-home.js',
  './js/07-timer-calendar.js',
  './js/08-analytics.js',
  './js/09-misc.js',
  './js/10-apply.js',
  './js/11-boot.js',
  './js/12-textbooks.js',
  './js/13-exam-plan.js',
  './js/14-kyotsu.js',
  './js/15-past-exams.js',
  './js/16-live.js',
  './js/17-money.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore-compat.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つでも失敗すると addAll 全体が失敗するので、個別に入れて取りこぼしを許容する
    await Promise.all(PRECACHE.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(err => console.warn('[sw] precache skip', u, err))));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k.startsWith('juken-')).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ページ側から「すぐ新版に入れ替えて」と言われたら待機をやめる
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'GET_VERSION') e.source?.postMessage({ type: 'VERSION', version: SW_VERSION });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // GET 以外（Gemini APIやFirestoreへの書き込み等）はそのまま通す
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Firestore / Gemini などのAPI通信はキャッシュしない（常に最新が必要）
  if (/googleapis\.com|firestore|firebaseio|google-analytics/.test(url.hostname) &&
      !/^https:\/\/www\.gstatic\.com/.test(url.origin)) return;

  const isAppFile = url.origin === self.location.origin;

  e.respondWith((async () => {
    try {
      // まずネットワーク。取れたらキャッシュを更新しておく（更新がすぐ反映される）
      // 自分のファイルは HTTPキャッシュを経由させない。
      // 経由すると古いJSが返り、新バージョンに切り替わらなくなる。
      const fresh = await fetch(isAppFile ? new Request(req, { cache: 'no-store' }) : req);
      if (fresh && fresh.status === 200 && (fresh.type === 'basic' || fresh.type === 'cors')) {
        const cache = await caches.open(CACHE);
        e.waitUntil(cache.put(req, fresh.clone()).catch(() => {}));
      }
      return fresh;
    } catch (err) {
      // 圏外・機内モード：キャッシュから返す
      const cached = await caches.match(req);
      if (cached) return cached;
      // ページ遷移ならアプリ本体を返して、とりあえず開けるようにする
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
