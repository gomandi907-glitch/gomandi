/* GoMandi admin push service worker. Keep this file next to admin.html (same folder, https). */
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyC6Lr5tFasxTiOKQCAg9k2aEyf9-oiIGnk',
  projectId: 'mandigomart',
  messagingSenderId: '476945286618',
  appId: '1:476945286618:web:f519af3fb480cce777ace3'
});
firebase.messaging();

/* Always show the notification (even if some page of this site is open/visible). */
self.addEventListener('push', function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (x) { return; }
  var d = p.data || {};
  if (!d.orderId && !d.title) return;
  var title = d.title || '🛒 NAYA ORDER';
  e.waitUntil((async function () {
    try {
      var cl = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      cl.forEach(function (c) { c.postMessage({ type: 'gm-order', orderId: d.orderId, name: d.name, total: d.total, n: d.n }); });
    } catch (x) {}
    await self.registration.showNotification(title, {
      body: d.body || '',
      tag: 'gm-order-' + (d.orderId || Date.now()),
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [600, 200, 600, 200, 600, 200, 600, 200, 600],
      data: { url: d.url || '' }
    });
  })());
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
    for (var i = 0; i < cl.length; i++) { if ('focus' in cl[i]) return cl[i].focus(); }
    if (url && self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
