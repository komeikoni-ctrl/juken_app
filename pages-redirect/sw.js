// ============================================================
// 旧公開先（GitHub Pages / Firebase Hosting）の Service Worker を
// 解除するためだけのファイル。
// ------------------------------------------------------------
// 旧アプリを入れていた端末では、ブラウザがこの sw.js を「新しい版」として
// 取り込む。すぐに有効化して、旧アプリのキャッシュを全部消し、自分自身を
// 登録解除してから、開いている画面を読み込み直す。読み込み直した画面には
// 転送ページ（index.html）が出て、Vercel 版へ案内される。
// fetch ハンドラは持たない（通信はすべてそのままネットワークへ）。
// ============================================================
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch (e) {}
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    try {
      const list = await self.clients.matchAll({ type: 'window' });
      for (const c of list) { try { await c.navigate(c.url); } catch (e) {} }
    } catch (e) {}
  })());
});
