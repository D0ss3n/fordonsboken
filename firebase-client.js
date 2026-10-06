import { firebaseConfig } from './firebase-config.js?v=share-qr-20261006';

const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
const signal = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

if (!configured) {
  window.FordonsmappenFirebase = { configured: false };
  signal('fordonsmappen-firebase-ready', { configured: false });
} else {
  const [appSdk, authSdk, firestoreSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),
  ]);

  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  window.FordonsmappenFirebase = {
    configured: true,
    signIn: () => authSdk.signInWithPopup(auth, provider),
    signOut: () => authSdk.signOut(auth),
    async loadState(uid) {
      const ref = firestoreSdk.doc(db, 'users', uid, 'appData', 'primary');
      const snapshot = await firestoreSdk.getDoc(ref);
      return snapshot.exists() ? snapshot.data() : null;
    },
    async publishVehicle(vehicleId, payload) {
      const ref = firestoreSdk.doc(db, 'publicVehicles', vehicleId);
      await firestoreSdk.setDoc(ref, payload);
    },
    async removePublishedVehicle(vehicleId) {
      const ref = firestoreSdk.doc(db, 'publicVehicles', vehicleId);
      await firestoreSdk.deleteDoc(ref);
    },
    async loadPublishedVehicle(vehicleId) {
      const ref = firestoreSdk.doc(db, 'publicVehicles', vehicleId);
      const snapshot = await firestoreSdk.getDoc(ref);
      return snapshot.exists() ? snapshot.data() : null;
    },
    async saveState(uid, state) {
      const ref = firestoreSdk.doc(db, 'users', uid, 'appData', 'primary');
      await firestoreSdk.setDoc(ref, {
        state,
        schemaVersion: 1,
        updatedAt: firestoreSdk.serverTimestamp(),
      });
    },
  };

  authSdk.getRedirectResult(auth).catch(error => {
    console.error('Google redirect-inloggningen misslyckades', error);
    signal('fordonsmappen-auth-error', { code: error.code });
  });

  authSdk.onAuthStateChanged(auth, user => {
    signal('fordonsmappen-auth', {
      user: user ? { uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL } : null,
    });
  });
  signal('fordonsmappen-firebase-ready', { configured: true });
}
