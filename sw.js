// Garde l'app utilisable hors ligne : fichiers de l'app en cache, réseau en priorité.
const CACHE = "skiapp-v2";
const FICHIERS = ["./", "index.html", "style.css", "app.js", "stations.json", "icon.svg", "manifest.webmanifest", "carte.html", "carte.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(rep => { const copie = rep.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); return rep; })
      .catch(() => caches.match(e.request))
  );
});
