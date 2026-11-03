const CACHE = 'meu-financeiro-public-v1'
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/offline.html', '/icon-192.png'])),
  )
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  )
  self.clients.claim()
})
self.addEventListener('fetch', (event) => {
  if (
    event.request.mode === 'navigate' &&
    new URL(event.request.url).origin === self.location.origin
  ) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html')),
    )
  }
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() || {}
  } catch {}
  event.waitUntil(
    self.registration.showNotification('Meu Financeiro', {
      body: 'Que tal revisar seu dia?',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag || 'review',
      data: { url: '/movimentos/novo' },
    }),
  )
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.openWindow(
      new URL('/movimentos/novo', self.location.origin).href,
    ),
  )
})
