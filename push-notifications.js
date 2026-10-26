import { firebaseConfig } from './firebase-config.js?v=push-messaging-20261026';

const sdkVersion = '12.19.0';
const messagingSdkUrl = `https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-messaging.js`;
const appSdkUrl = `https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app.js`;
const authSdkUrl = `https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-auth.js`;
const functionsSdkUrl = `https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-functions.js`;
let messagingSdkPromise;
let foregroundListenerReady = false;

async function sdk() {
  if (!messagingSdkPromise) {
    messagingSdkPromise = Promise.all([
      import(appSdkUrl),
      import(authSdkUrl),
      import(messagingSdkUrl),
      import(functionsSdkUrl),
    ]).then(([appSdk, auth, messaging, functions]) => {
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
      return { app, auth, messaging, functions };
    });
  }
  return messagingSdkPromise;
}

function listenForForegroundMessages(messaging, messageClient) {
  if (foregroundListenerReady) return;
  messaging.onMessage(messageClient, payload => {
    const data = payload.data || {};
    window.dispatchEvent(new CustomEvent('fordonsmappen-push-message', {
      detail: { title: data.title || 'Fordonsmappen', body: data.body || 'Du har en påminnelse.' },
    }));
  });
  foregroundListenerReady = true;
}

async function attachForegroundListener() {
  if (!window.FordonsmappenFirebase?.configured) return;
  try {
    const { app, messaging } = await sdk();
    if (!await messaging.isSupported()) return;
    listenForForegroundMessages(messaging, messaging.getMessaging(app));
  } catch (error) {
    console.info('Foreground push notifications are not available in this browser.', error?.code || 'unsupported');
  }
}

async function enable() {
  if (!window.FordonsmappenFirebase?.configured) throw new Error('Firebase är inte tillgängligt.');
  if (!window.FordonsmappenFirebase.currentUser?.()) throw new Error('Logga in innan du aktiverar telefonnotiser.');
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window)) {
    throw new Error('Den här webbläsaren stöder inte telefonnotiser här.');
  }
  if (!firebaseConfig.webPushVapidKey) {
    throw new Error('Pushnyckeln behöver först hämtas från Firebase Console.');
  }

  // Request permission directly from this user action, before awaiting other APIs.
  if (Notification.permission === 'denied') {
    throw new Error('Notiser är blockerade för Fordonsmappen. Tillåt dem i webbläsarens eller telefonens webbplatsinställningar och försök igen.');
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notiser tilläts inte. Du kan ändra det i webbläsarens inställningar.');

  const [{ app, auth, messaging, functions }, serviceWorkerRegistration] = await Promise.all([
    sdk(), navigator.serviceWorker.register('/firebase-messaging-sw.js'),
  ]);
  if (!auth.getAuth(app).currentUser) throw new Error('Logga in innan du aktiverar telefonnotiser.');
  if (!await messaging.isSupported()) throw new Error('Firebase-notiser stöds inte i den här webbläsaren.');
  const messageClient = messaging.getMessaging(app);
  const token = await messaging.getToken(messageClient, {
    vapidKey: firebaseConfig.webPushVapidKey,
    serviceWorkerRegistration,
  });
  if (!token) throw new Error('Webbläsaren kunde inte registreras för notiser.');

  const callable = functions.httpsCallable(functions.getFunctions(app, 'europe-north1'), 'registerPushToken');
  await callable({ token });

  listenForForegroundMessages(messaging, messageClient);
  return true;
}

async function disable() {
  const [{ app, auth, messaging, functions }, serviceWorkerRegistration] = await Promise.all([
    sdk(),
    navigator.serviceWorker.getRegistration('/'),
  ]);
  if (!auth.getAuth(app).currentUser) throw new Error('Logga in för att stänga av telefonnotiser.');
  const messageClient = messaging.getMessaging(app);
  const token = await messaging.getToken(messageClient, {
    vapidKey: firebaseConfig.webPushVapidKey,
    serviceWorkerRegistration,
  });
  if (token) {
    const callable = functions.httpsCallable(functions.getFunctions(app, 'europe-north1'), 'unregisterPushToken');
    await callable({ token });
    await messaging.deleteToken(messageClient);
  }
  return true;
}

window.FordonsmappenPush = {
  enable,
  disable,
  isConfigured: Boolean(firebaseConfig.webPushVapidKey),
};
window.dispatchEvent(new CustomEvent('fordonsmappen-push-ready'));
window.addEventListener('fordonsmappen-firebase-ready', event => {
  if (event.detail?.configured) attachForegroundListener();
});
if (window.FordonsmappenFirebase?.configured) attachForegroundListener();
