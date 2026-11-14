// Service worker страницы уровней (Bootstrap/Docs/LevelEditorSync_Plan.md §7, этап 4): страница открывается без сети.
// Файлы страницы — из кэша сразу, параллельно — свежие с сервера в кэш; страница изменилась — открытой странице
// сообщение «update» (она предложит обновить). Данные уровней здесь не хранятся — они в IndexedDB страницы.
// Запросы к GitHub API (другой адрес) и /api/... не трогает.
const CACHE = "level-editor-v1";
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Адрес → ключ кэша: «/», «/index.html» и «/?standalone» — одна страница.
function shellKey(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return null;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return null;
  const rest = url.pathname.slice(scope.pathname.length);
  if (request.mode === "navigate" || rest === "" || rest === "index.html") return new URL("./", scope).href;
  return SHELL.includes(rest) ? url.origin + url.pathname : null;
}

async function refresh(key, request, cached) {
  try {
    const fresh = await fetch(request.mode === "navigate" ? key : request, { cache: "no-cache" });
    if (!fresh.ok) return null;
    const cache = await caches.open(CACHE);
    await cache.put(key, fresh.clone());
    if (cached && key.endsWith("/")) {
      const [a, b] = await Promise.all([cached.text(), fresh.clone().text()]);
      if (a !== b) for (const client of await self.clients.matchAll()) client.postMessage({ type: "update" });
    }
    return fresh;
  } catch {
    return null; // нет сети
  }
}

self.addEventListener("fetch", (event) => {
  const key = shellKey(event.request);
  if (!key) return;
  event.respondWith((async () => {
    const cached = await caches.match(key);
    // Копия — для сравнения: тело отданного странице ответа уже будет прочитано.
    const update = refresh(key, event.request, cached ? cached.clone() : null);
    if (cached) {
      event.waitUntil(update);
      return cached;
    }
    return (await update) || new Response("Нет сети, и страница ещё не сохранена на устройстве — откройте её один раз с интернетом.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  })());
});
