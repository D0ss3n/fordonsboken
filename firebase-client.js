import { firebaseConfig } from './firebase-config.js?v=storage-sync-20261006';
import { createVehicleModelV2Plan } from './vehicle-model-v2.js?v=vehicle-model-v2-20261007';

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
    async migrateVehicleModelV2(uid, state) {
      if (auth.currentUser?.uid !== uid) throw new Error('Du kan bara migrera det inloggade kontots data.');
      const markerRef = firestoreSdk.doc(db, 'users', uid, 'migrationStatus', 'vehicleModelV2');
      const marker = await firestoreSdk.getDoc(markerRef);
      if (marker.exists() && marker.data().schemaVersion === 2 && marker.data().complete === true) {
        return { migrated: false, counts: marker.data().counts || {} };
      }

      const plan = createVehicleModelV2Plan(uid, state);
      const bootstrapKinds = new Set(['vehicle', 'member', 'vehicle-index', 'ownership-history']);
      const bootstrap = plan.writes.filter(write => bootstrapKinds.has(write.kind));
      const records = plan.writes.filter(write => !bootstrapKinds.has(write.kind));
      const groupByVehicle = writes => {
        const groups = new Map();
        for (const write of writes) {
          const segments = write.path.split('/');
          const vehicleId = write.kind === 'vehicle-index'
            || write.path.startsWith(`users/${uid}/privateVehicles/`)
            ? segments[3]
            : segments[1];
          if (!groups.has(vehicleId)) groups.set(vehicleId, []);
          groups.get(vehicleId).push(write);
        }
        return groups;
      };
      const commitGroups = async writes => {
        for (const group of groupByVehicle(writes).values()) {
          for (let offset = 0; offset < group.length; offset += 400) {
            const batch = firestoreSdk.writeBatch(db);
            group.slice(offset, offset + 400).forEach(write => {
              batch.set(firestoreSdk.doc(db, ...write.path.split('/')), write.data, { merge: true });
            });
            await batch.commit();
          }
        }
      };

      // Each vehicle's parent, owner relation, index, and initial history are
      // committed together so the rules can validate the relationship.
      for (const group of groupByVehicle(bootstrap).values()) {
        const batch = firestoreSdk.writeBatch(db);
        group.forEach(write => {
          batch.set(firestoreSdk.doc(db, ...write.path.split('/')), write.data, { merge: true });
        });
        await batch.commit();
      }
      await commitGroups(records);
      await firestoreSdk.setDoc(markerRef, {
        schemaVersion: 2,
        sourceSchemaVersion: 1,
        complete: true,
        counts: plan.counts,
        vehicleCount: plan.vehicleCount,
        completedAt: firestoreSdk.serverTimestamp(),
      });
      return { migrated: true, counts: plan.counts, vehicleCount: plan.vehicleCount };
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
