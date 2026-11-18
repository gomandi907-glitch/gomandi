/* GoMandi admin push service worker. Keep this file next to admin_fixed.html (same folder, https). */
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyC6Lr5tFasxTiOKQCAg9k2aEyf9-oiIGnk',
  projectId: 'mandigomart',
  messagingSenderId: '476945286618',
  appId: '1:476945286618:web:f519af3fb480cce777ace3'
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(function (p) {
  const d = (p && p.data) || {};
  const title = d.title || '🛒 NAYA ORDER';
  // if admin page is open, let it ring the loud siren too
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
    cl.forEach(function (c) { c.postMessage({ type: 'gm-order', orderId: d.orderId, name: d.name, total: d.total, n: d.n }); });
  });
  return self.registration.showNotification(title, {
    body: d.body || '',
    tag: 'gm-order-' + (d.orderId || Date.now()),
    renotify: true,
    requireInteraction: true,
    vibrate: [600, 200, 600, 200, 600, 200, 600, 200, 600],
    data: { url: d.url || '' }
  });
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
    for (const c of cl) { if ('focus' in c) return c.focus(); }
    if (url && self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
