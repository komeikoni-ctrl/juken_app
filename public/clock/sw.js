const CACHE = "standby-clock-v2";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon.svg"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  // 自分（standby-clock-*）の旧キャッシュだけ消す。他のアプリのキャッシュには触らない
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("standby-clock-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 天気などの外部APIは常にネットワーク
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
