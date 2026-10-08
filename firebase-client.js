import { firebaseConfig } from './firebase-config.js?v=storage-sync-20261006';
import { createVehicleModelV2Plan } from './vehicle-model-v2.js?v=vehicle-model-v2-20261007';

const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
const signal = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

if (!configured) {
  window.FordonsmappenFirebase = { configured: false };
  signal('fordonsmappen-firebase-ready', { configured: false });
} else {
  const [appSdk, authSdk, firestoreSdk, storageSdk, functionsSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js'),
  ]);

  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);
  const storage = storageSdk.getStorage(app);
  const functions = functionsSdk.getFunctions(app, 'europe-north1');
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const vehicleModelCache = new Map();
  const docRef = path => firestoreSdk.doc(db, ...path.split('/'));
  const collectionRef = path => firestoreSdk.collection(db, ...path.split('/'));
  const sameData = (left, right) => {
    const canonical = value => Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
        : value;
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  };
  const vehicleForWrite = (write, uid) => {
    const segments = write.path.split('/');
    return write.kind === 'vehicle-index' || write.path.startsWith(`users/${uid}/privateVehicles/`)
      ? segments[3]
      : segments[1];
  };
  const groupedWrites = (writes, uid) => {
    const groups = new Map();
    for (const write of writes) {
      const vehicleId = vehicleForWrite(write, uid);
      if (!groups.has(vehicleId)) groups.set(vehicleId, []);
      groups.get(vehicleId).push(write);
    }
    return groups;
  };
  const recordSnapshot = (cache, snapshot) => {
    snapshot.docs.forEach(item => cache.set(item.ref.path, item.data()));
  };
  async function readVehicleModelV2(uid, fallbackState = {}) {
    const cache = new Map();
    const indexSnapshot = await firestoreSdk.getDocs(collectionRef(`users/${uid}/vehicleMemberships`));
    recordSnapshot(cache, indexSnapshot);
    const memberships = indexSnapshot.docs.filter(item => item.data().active === true);
    const vehicles = [], events = [], problems = [], reminders = [], tireSets = [];
    const detail = (data, remove = []) => {
      const result = { ...data };
      ['schemaVersion', ...remove].forEach(key => delete result[key]);
      return result;
    };
    for (const membership of memberships) {
      const vehicleId = membership.data().vehicleId || membership.id;
      const [vehicleSnapshot, memberSnapshot, eventSnapshot, problemSnapshot,
        historySnapshot, eventDetailSnapshot, attachmentSnapshot, privateProblemSnapshot,
        reminderSnapshot, tireSnapshot] = await Promise.all([
        firestoreSdk.getDoc(docRef(`vehicles/${vehicleId}`)),
        firestoreSdk.getDoc(docRef(`vehicles/${vehicleId}/members/${uid}`)),
        firestoreSdk.getDocs(collectionRef(`vehicles/${vehicleId}/events`)),
        firestoreSdk.getDocs(collectionRef(`vehicles/${vehicleId}/problems`)),
        firestoreSdk.getDocs(collectionRef(`vehicles/${vehicleId}/ownershipHistory`)),
        firestoreSdk.getDocs(collectionRef(`users/${uid}/privateVehicles/${vehicleId}/eventDetails`)),
        firestoreSdk.getDocs(collectionRef(`users/${uid}/privateVehicles/${vehicleId}/attachments`)),
        firestoreSdk.getDocs(collectionRef(`users/${uid}/privateVehicles/${vehicleId}/problems`)),
        firestoreSdk.getDocs(collectionRef(`users/${uid}/privateVehicles/${vehicleId}/reminders`)),
        firestoreSdk.getDocs(collectionRef(`users/${uid}/privateVehicles/${vehicleId}/tireSets`)),
      ]);
      if (!vehicleSnapshot.exists() || !memberSnapshot.exists()) continue;
      cache.set(vehicleSnapshot.ref.path, vehicleSnapshot.data());
      cache.set(memberSnapshot.ref.path, memberSnapshot.data());
      [eventSnapshot, problemSnapshot, historySnapshot, eventDetailSnapshot,
        attachmentSnapshot, privateProblemSnapshot, reminderSnapshot, tireSnapshot]
        .forEach(snapshot => recordSnapshot(cache, snapshot));

      const vehicleData = vehicleSnapshot.data();
      const storedVehicle = vehicleData.vehicle || {};
      vehicles.push({
        ...storedVehicle,
        id: vehicleSnapshot.id,
        reg: storedVehicle.registration || '',
        _createdByUid: vehicleData.createdByUid,
        _membershipData: memberSnapshot.data(),
      });

      const eventDetails = new Map(eventDetailSnapshot.docs.map(item => [item.id, item.data()]));
      const attachments = new Map();
      attachmentSnapshot.docs.forEach(item => {
        const data = item.data();
        if (!attachments.has(data.eventId)) attachments.set(data.eventId, []);
        attachments.get(data.eventId).push({ ...detail(data, ['eventId']) });
      });
      eventSnapshot.docs.forEach(item => {
        const core = item.data();
        const privateData = eventDetails.get(item.id) || {};
        events.push({
          ...detail(privateData, ['eventId']),
          ...core,
          id: core.id || item.id,
          vehicle: vehicleId,
          _createdByUid: core.createdByUid,
          attachments: attachments.get(item.id) || privateData.attachments || [],
        });
      });

      const privateProblems = new Map(privateProblemSnapshot.docs.map(item => [item.id, item.data()]));
      problemSnapshot.docs.forEach(item => {
        const core = item.data();
        problems.push({
          ...detail(privateProblems.get(item.id) || {}),
          ...core,
          id: core.id || item.id,
          vehicle: vehicleId,
          _createdByUid: core.createdByUid,
        });
      });
      reminderSnapshot.docs.forEach(item => reminders.push({ ...detail(item.data()), vehicle: vehicleId }));
      tireSnapshot.docs.forEach(item => tireSets.push({ ...detail(item.data()), vehicle: vehicleId }));
    }
    const vehicleIds = new Set(vehicles.map(item => item.id));
    vehicleModelCache.set(uid, cache);
    return {
      ...fallbackState,
      vehicles,
      events,
      problems,
      reminders,
      tireSets,
      active: vehicleIds.has(fallbackState.active) ? fallbackState.active : (vehicles[0]?.id || null),
    };
  }

  const isOwnerRecord = (path, data, uid) => {
    const parts = path.split('/');
    return path.startsWith('vehicles/')
      && (parts[2] === 'events' || parts[2] === 'problems')
      && data?.createdByUid === uid;
  };
  const isPrivateRecord = (path, uid) => path.startsWith(`users/${uid}/privateVehicles/`);
  const cachePlan = (cache, writes) => writes.forEach(write => cache.set(write.path, write.data));
  const accountPreferences = state => Object.fromEntries(
    Object.entries(state || {}).filter(([key]) => ![
      'vehicles', 'events', 'problems', 'reminders', 'tireSets',
    ].includes(key)),
  );

  async function persistVehicleModelPlan(uid, state, { migration = false } = {}) {
    const plan = createVehicleModelV2Plan(uid, state);
    let cache = vehicleModelCache.get(uid);
    if (!cache) {
      cache = await readVehicleModelV2(uid, state).then(() => vehicleModelCache.get(uid));
      if (!cache) cache = new Map();
    }

    const bootstrapKinds = new Set(['vehicle', 'member', 'vehicle-index', 'ownership-history']);
    const writes = plan.writes.filter(write => {
      if (write.kind === 'vehicle-event' || write.kind === 'vehicle-problem') {
        // Earlier owners' entries remain visible, but cannot be rewritten by a later owner.
        if (write.data.createdByUid !== uid) return false;
      }
      return migration || !sameData(cache.get(write.path), write.data);
    });
    const deletes = [];
    if (!migration) {
      const desired = new Set(plan.writes.map(write => write.path));
      for (const [path, data] of cache) {
        if (desired.has(path)) continue;
        if (isPrivateRecord(path, uid) || isOwnerRecord(path, data, uid)) deletes.push(path);
      }
    }

    const groups = groupedWrites(writes, uid);
    for (const [vehicleId, group] of groups) {
      // Keep bootstrap writes in the first atomic batch, as Firestore rules validate
      // the vehicle, owner membership, and per-user index together.
      const ordered = migration
        ? [...group.filter(write => bootstrapKinds.has(write.kind)), ...group.filter(write => !bootstrapKinds.has(write.kind))]
        : group;
      for (let offset = 0; offset < ordered.length; offset += 400) {
        const chunk = ordered.slice(offset, offset + 400);
        const batch = firestoreSdk.writeBatch(db);
        chunk.forEach(write => batch.set(docRef(write.path), write.data));
        await batch.commit();
        cachePlan(cache, chunk);
      }
    }

    const deleteGroups = new Map();
    for (const path of deletes) {
      const parts = path.split('/');
      const vehicleId = path.startsWith(`users/${uid}/privateVehicles/`) ? parts[3] : parts[1];
      if (!deleteGroups.has(vehicleId)) deleteGroups.set(vehicleId, []);
      deleteGroups.get(vehicleId).push(path);
    }
    for (const paths of deleteGroups.values()) {
      for (let offset = 0; offset < paths.length; offset += 400) {
        const chunk = paths.slice(offset, offset + 400);
        const batch = firestoreSdk.writeBatch(db);
        chunk.forEach(path => batch.delete(docRef(path)));
        await batch.commit();
        chunk.forEach(path => cache.delete(path));
      }
    }

    vehicleModelCache.set(uid, cache);
    return plan;
  }

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
    async createVehicleTransfer(vehicleId) {
      const call = functionsSdk.httpsCallable(functions, 'createVehicleTransfer');
      const response = await call({ vehicleId });
      return response.data;
    },
    async acceptVehicleTransfer(code) {
      const call = functionsSdk.httpsCallable(functions, 'acceptVehicleTransfer');
      const response = await call({ code });
      return response.data;
    },
    async loadState(uid) {
      const ref = docRef(`users/${uid}/appData/primary`);
      const markerRef = docRef(`users/${uid}/migrationStatus/vehicleModelV2`);
      const [snapshot, marker] = await Promise.all([
        firestoreSdk.getDoc(ref),
        firestoreSdk.getDoc(markerRef),
      ]);
      const legacy = snapshot.exists() ? snapshot.data() : null;
      const migrationComplete = marker.exists()
        && marker.data().schemaVersion === 2
        && marker.data().complete === true;
      const preferences = migrationComplete
        ? await firestoreSdk.getDoc(docRef(`users/${uid}/appData/preferences-v2`))
        : null;
      const fallbackState = {
        ...(legacy?.state || {}),
        ...(preferences?.exists() ? preferences.data().state || {} : {}),
      };

      if (migrationComplete) {
        return {
          ...(legacy || { schemaVersion: 1 }),
          state: await readVehicleModelV2(uid, fallbackState),
          schemaVersion: 2,
        };
      }
      if (!legacy) return null;

      await this.migrateVehicleModelV2(uid, legacy.state || {});
      return {
        ...legacy,
        state: await readVehicleModelV2(uid, legacy.state || {}),
        schemaVersion: 2,
      };
    },
    async migrateVehicleModelV2(uid, state) {
      if (auth.currentUser?.uid !== uid) throw new Error('Du kan bara migrera det inloggade kontots data.');
      const markerRef = firestoreSdk.doc(db, 'users', uid, 'migrationStatus', 'vehicleModelV2');
      const marker = await firestoreSdk.getDoc(markerRef);
      if (marker.exists() && marker.data().schemaVersion === 2 && marker.data().complete === true) {
        return { migrated: false, counts: marker.data().counts || {} };
      }

      const plan = await persistVehicleModelPlan(uid, state, { migration: true });
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
    async publishVehicle(vehicleId, snapshot) {
      const call = functionsSdk.httpsCallable(functions, 'publishPublicVehicle');
      const response = await call({ vehicleId, snapshot });
      return response.data.shareToken;
    },
    async removePublishedVehicle(vehicleId) {
      const call = functionsSdk.httpsCallable(functions, 'revokePublicVehicleShare');
      return (await call({ vehicleId })).data;
    },
    async loadPublishedVehicle(vehicleId) {
      const ref = firestoreSdk.doc(db, 'publicVehicles', vehicleId);
      const snapshot = await firestoreSdk.getDoc(ref);
      return snapshot.exists() ? snapshot.data() : null;
    },
    async saveState(uid, state) {
      if (auth.currentUser?.uid !== uid) throw new Error('Du kan bara spara det inloggade kontots data.');
      const backupRef = docRef(`users/${uid}/appData/primary`);
      const preferencesRef = docRef(`users/${uid}/appData/preferences-v2`);
      const marker = await firestoreSdk.getDoc(docRef(`users/${uid}/migrationStatus/vehicleModelV2`));
      if (!marker.exists() || marker.data().schemaVersion !== 2 || marker.data().complete !== true) {
        const backup = await firestoreSdk.getDoc(backupRef);
        if (!backup.exists()) {
          await firestoreSdk.setDoc(backupRef, {
            state,
            schemaVersion: 1,
            updatedAt: firestoreSdk.serverTimestamp(),
          });
        }
        await this.migrateVehicleModelV2(uid, state);
        await firestoreSdk.setDoc(preferencesRef, {
          state: accountPreferences(state),
          schemaVersion: 2,
          updatedAt: firestoreSdk.serverTimestamp(),
        });
        return;
      }
      // Keep the original v1 document intact as a rollback snapshot; evolving
      // account-level settings are stored beside it while v2 owns vehicle data.
      await firestoreSdk.setDoc(preferencesRef, {
        state: accountPreferences(state),
        schemaVersion: 2,
        updatedAt: firestoreSdk.serverTimestamp(),
      });
      await persistVehicleModelPlan(uid, state);
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
