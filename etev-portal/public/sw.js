// ETEV Fleet Portal · Copyright (c) 2026 Letarik Teshome. All rights reserved. See LICENSE.
// ETEV Fleet Portal service worker: makes the app installable and loads the page shell fast on weak signal.
// It NEVER caches /api — all fleet data always comes live from the server.
const CACHE = 'etev-shell-v49f';
const SHELL = ['/', '/styles.css', '/d3.min.js', '/qr.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/app/')) return; // never cache the Android app file
  // Network first (so updates show straight away), cached copy only when offline
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
