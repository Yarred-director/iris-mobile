self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function handleReplyPush() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) client.postMessage({ type: 'IRIS_REPLY_READY' });

  const visible = windows.some((client) => client.visibilityState === 'visible');
  if (visible) return;

  await self.registration.showNotification('Iris', {
    body: 'Iris ti odpísala.',
    icon: '/iris-icon.svg',
    badge: '/iris-icon.svg',
    tag: 'iris-reply',
    renotify: true,
    data: { url: '/' },
  });
}

self.addEventListener('push', (event) => {
  event.waitUntil(handleReplyPush());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification?.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(targetUrl).catch(() => null);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
