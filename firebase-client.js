import { firebaseConfig } from './firebase-config.js?v=storage-sync-20261006';

const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
const signal = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

if (!configured) {
  window.FordonsmappenFirebase = { configured: false };
  signal('fordonsmappen-firebase-ready', { configured: false });
} else {
  const [appSdk, authSdk, firestoreSdk, storageSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js'),
  ]);

  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);
  const storage = storageSdk.getStorage(app);
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  window.FordonsmappenFirebase = {
    configured: true,
    signIn: () => authSdk.signInWithPopup(auth, provider),
    signOut: () => authSdk.signOut(auth),
    async uploadAttachment(uid, eventId, file, attachmentId) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `users/${uid}/events/${eventId}/${attachmentId}-${safeName}`;
      const target = storageSdk.ref(storage, path);
      const uploaded = await storageSdk.uploadBytes(target, file, { contentType: file.type || 'application/octet-stream' });
      return { path: uploaded.ref.fullPath, name: file.name, type: file.type };
    },
    async downloadAttachment(path) {
      const url = await storageSdk.getDownloadURL(storageSdk.ref(storage, path));
      const response = await fetch(url);
      if (!response.ok) throw new Error('Kunde inte hämta den bifogade filen.');
      return response.blob();
    },
    async deleteAttachment(path) {
      await storageSdk.deleteObject(storageSdk.ref(storage, path));
    },
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
