// ネットワーク優先戦略（Network First）
// 常に最新ファイルをネットワークから取得し、オフライン時のみキャッシュを使用
const CACHE_NAME = "ipad-escape-v6";

self.addEventListener("install", () => {
  self.skipWaiting(); // 即座に有効化
});

self.addEventListener("activate", (event) => {
  // 古いキャッシュをすべて削除
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(cacheNames.map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.url.includes("script.google.com")) return;

  event.respondWith(
    // まずネットワークから取得を試みる
    fetch(event.request)
      .then((response) => {
        // ローカルファイル（same-origin）のみキャッシュに保存
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request);
      })
  );
});
