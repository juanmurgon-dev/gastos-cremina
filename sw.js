// Service worker: hace la app instalable y de arranque rápido.
// Estrategia "network-first" para archivos propios: siempre intenta la
// versión más nueva de internet y solo usa el caché si no hay conexión.
// Así, cuando publicas una actualización, aparece de inmediato.
const CACHE = "cremina-gastos-v318";
// Rutas relativas: la app funciona igual en la raíz de un dominio propio
// o en un subpath tipo usuario.github.io/repo/ (GitHub Pages).
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./assets/cremina-wordmark.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  // NO hacemos skipWaiting automático: la versión nueva "espera" hasta que el
  // usuario toque "Actualizar" en la app (o hasta el próximo arranque limpio).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

// La app pide activar la versión nueva ya (botón "Actualizar").
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Solo manejamos archivos propios (mismo origen). Todo lo de Supabase va directo a la red.
  if (url.origin !== location.origin) return;

  // Network-first: intenta la red, guarda copia fresca y si falla usa el caché.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match(new URL("./index.html", self.location).href)))
  );
});
