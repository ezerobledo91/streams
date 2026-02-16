const CACHE_NAME = "streams-v4";
const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Skip non-GET (POST, DELETE, etc.) — dejar que el browser los maneje directamente
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // No interceptar API calls ni HLS — siempre directo al servidor
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/hls/")) {
    return;
  }

  // Network-first para HTML (index.html y navegacion SPA)
  // Esto asegura que tras un nuevo build, el browser siempre cargue el HTML actualizado
  const isNavigationOrHtml =
    event.request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname.endsWith(".html");

  if (isNavigationOrHtml) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html")))
    );
    return;
  }

  // Cache-first para assets estaticos (con hash en el nombre, cambian por build)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
