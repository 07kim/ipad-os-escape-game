// ネットワーク優先戦略（Network First）
// 常に最新ファイルをネットワークから取得し、オフライン時のみキャッシュを使用
const CACHE_NAME = "ipad-escape-v11-evidence";

self.addEventListener("install", () => {
  self.skipWaiting(); // 即座に有効化
});

self.addEventListener("activate", (event) => {
  // 古いバージョンのキャッシュをすべて削除
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// 🧹 メインスレッドからのキャッシュ全消去要求（一括初期化時）
self.addEventListener("message", (event) => {
  if (event.data && event.data.action === "clear_all_caches") {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
    );
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.url.includes("script.google.com")) return;
  // ⚠️ 管理画面（admin.html）や演者ツールは常に生ファイルを直接取得（絶対にキャッシュさせない）
  if (event.request.url.includes("admin.html") || event.request.url.includes("actor.html")) return;

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
