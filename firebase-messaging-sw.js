/* Handle notification clicks before loading Firebase Messaging. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.navigate(destination);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination);
  })());
});

importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCebbUijenF7zMq_nZOLr0kJCO-lHJpU3I',
  authDomain: 'fordonsmappen-af27a.firebaseapp.com',
  projectId: 'fordonsmappen-af27a',
  messagingSenderId: '567319967961',
  appId: '1:567319967961:web:39dcf640d69af7dc2566c8',
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || 'Fordonsmappen', {
    body: data.body || 'Du har en påminnelse för ditt fordon.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: {
      url: data.url || '/',
      reminderId: data.reminderId || '',
      vehicleId: data.vehicleId || '',
    },
  });
});
