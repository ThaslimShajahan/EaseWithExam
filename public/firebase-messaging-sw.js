// Service worker for direct Web Push notifications (no Firebase Messaging needed)
// Push events arrive here when send-push Edge Function sends via Web Push Protocol

self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const { title = 'EaseWithExam', body = '', url = '/dashboard', icon = '/pwa-192x192.png' } = event.data.json();
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon,
        badge:  '/pwa-64x64.png',
        data:   { url },
        tag:    'ewe-notification',
        renotify: true,
        actions: [
          { action: 'open',    title: 'Open App' },
          { action: 'dismiss', title: 'Dismiss'  },
        ],
      })
    );
  } catch (err) {
    console.error('[SW] push parse error:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find(c => c.url.includes(self.location.origin) && 'focus' in c);
      if (existing) { existing.navigate(url); return existing.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
