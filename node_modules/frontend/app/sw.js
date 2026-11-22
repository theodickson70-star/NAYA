// NAYA service worker — kazi moja tu: kuonyesha arifa (Web Push) na kufungua app ukiibonyeza.
// HAKUNA kuhifadhi kurasa (cache), kwa hiyo kila mara unapata toleo jipya la app.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'NAYA', body: event.data ? event.data.text() : '' };
  }
  const urgent = data.tag === 'offer';
  event.waitUntil(
    self.registration.showNotification(data.title || 'NAYA', {
      body: data.body || '',
      icon: '/shared/brand/naya-192.png',
      badge: '/shared/brand/naya-192.png',
      tag: data.tag || 'naya',
      renotify: true,
      requireInteraction: urgent,
      vibrate: urgent ? [400, 150, 400, 150, 400] : [200],
      data: { url: data.url || '/app/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (win.url.includes('/app/') && 'focus' in win) return win.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
