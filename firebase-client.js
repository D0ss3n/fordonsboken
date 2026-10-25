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
  const runSyncStep = async (step, operation, details = null) => {
    try { return await operation(); }
    catch (error) {
      console.error('Firestore sync failed at ' + step, details, error);
      const wrapped = new Error(error?.message || String(error));
      wrapped.firebaseCode = error?.code || 'unknown';
      wrapped.code = `${wrapped.firebaseCode} · ${step}`;
      wrapped.syncStep = step;
      wrapped.cause = error;
      throw wrapped;
    }
  };
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

  async function deleteLocalAttachments(uid, knownAttachmentIds = []) {
    if (!globalThis.indexedDB) return false;
    const knownIds = new Set(knownAttachmentIds.filter(value => typeof value === 'string'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('fordonsmappen-attachments', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const localDb = request.result;
        if (!localDb.objectStoreNames.contains('files')) {
          localDb.close();
          resolve(true);
          return;
        }
        const transaction = localDb.transaction('files', 'readwrite');
        const store = transaction.objectStore('files');
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const record = cursor.value;
          if (record.ownerUid === uid || knownIds.has(record.id)) cursor.delete();
          cursor.continue();
        };
        cursorRequest.onerror = () => transaction.abort();
        transaction.oncomplete = () => {
          localDb.close();
          resolve(true);
        };
        transaction.onerror = () => {
          localDb.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          localDb.close();
          reject(transaction.error || new Error('Kunde inte rensa lokala bilagor.'));
        };
      };
    });
  }
  const isPrivateRecord = (path, uid) => path.startsWith(`users/${uid}/privateVehicles/`);
  const cachePlan = (cache, writes) => writes.forEach(write => cache.set(write.path, write.data));
  const accountPreferences = state => Object.fromEntries(
    Object.entries(state || {}).filter(([key]) => ![
      'vehicles', 'events', 'problems', 'reminders', 'tireSets', 'transferredVehicles',
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
      // Membership is established by vehicle creation or trusted transfer flows. A normal
      // save must not rewrite an existing membership document that Firestore treats as immutable.
      if (!migration && write.kind === 'member' && cache.has(write.path)) return false;
      // Ownership history is managed by trusted transfer/migration flows. A normal save
      // must not replace a real transfer record with the planner's legacy defaults.
      if (!migration && write.kind === 'ownership-history' && cache.has(write.path)) return false;
      return true;
    }).map(write => {
      if (migration || write.kind !== 'vehicle' || !cache.has(write.path)) return write;
      // A deleted former creator can leave stale creator metadata in the local snapshot.
      // Preserve the server's protected attribution so a current owner can still save
      // editable vehicle fields without trying to restore the former owner's UID.
      const existing = cache.get(write.path);
      const data = { ...write.data };
      if (Object.hasOwn(existing || {}, 'createdByUid')) data.createdByUid = existing.createdByUid;
      else delete data.createdByUid;
      return { ...write, data };
    }).filter(write => {
      if (!migration && (write.kind === 'vehicle-event' || write.kind === 'vehicle-problem')) {
        // Existing history without current-user attribution is immutable to this owner.
        const existing = cache.get(write.path);
        if (write.data.createdByUid !== uid) return false;
        if (existing && existing.createdByUid !== uid) return false;
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
        const kinds = [...new Set(chunk.map(write => write.kind))].join(', ');
        await runSyncStep('fordonsskrivning: ' + kinds, () => batch.commit(), chunk.map(({ kind, path }) => ({ kind, path })));
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
        await runSyncStep('borttagning av fordonsposter', () => batch.commit(), chunk);
        chunk.forEach(path => cache.delete(path));
      }
    }

    vehicleModelCache.set(uid, cache);
    return plan;
  }

  window.FordonsmappenFirebase = {
    configured: true,
    signIn: () => authSdk.signInWithPopup(auth, provider),
    signInWithEmail: (email, password) => authSdk.signInWithEmailAndPassword(auth, email, password),
    createAccountWithEmail: (email, password) => authSdk.createUserWithEmailAndPassword(auth, email, password),
    sendPasswordReset: email => authSdk.sendPasswordResetEmail(auth, email, { url: new URL('./', window.location.href).href }),
    async refreshCurrentUser() {
      const user = auth.currentUser;
      if (!user) return null;
      await authSdk.reload(user);
      await user.getIdToken(true);
      const currentUser = auth.currentUser;
      const payload = currentUser ? { uid: currentUser.uid, displayName: currentUser.displayName, email: currentUser.email, photoURL: currentUser.photoURL, emailVerified: currentUser.emailVerified, providerData: currentUser.providerData.map(({ providerId }) => ({ providerId })) } : null;
      signal('fordonsmappen-auth', { user: payload });
      return payload;
    },
    sendEmailVerification: () => {
      if (!auth.currentUser) throw new Error('Logga in för att verifiera e-postadressen.');
      return authSdk.sendEmailVerification(auth.currentUser, { url: new URL('./', window.location.href).href });
    },
    updateAccountProfile: (displayName, photoURL) => {
      if (!auth.currentUser) throw new Error('Logga in för att ändra profilen.');
      return authSdk.updateProfile(auth.currentUser, { displayName, photoURL });
    },
    async uploadProfilePhoto(file) {
      const user = auth.currentUser;
      if (!user) throw new Error('Logga in för att ändra profilbilden.');
      const target = storageSdk.ref(storage, `users/${user.uid}/profile/avatar`);
      const uploaded = await storageSdk.uploadBytes(target, file, { contentType: file.type });
      return storageSdk.getDownloadURL(uploaded.ref);
    },
    async syncGoogleProfilePhoto() {
      const user = auth.currentUser;
      if (!user) throw new Error('Logga in för att spara profilbilden.');
      const call = functionsSdk.httpsCallable(functions, 'syncGoogleProfilePhoto');
      const response = await call({});
      const photoURL = response.data?.photoURL || null;
      if (photoURL && user.photoURL !== photoURL) await authSdk.updateProfile(user, { photoURL });
      return photoURL;
    },
    signOut: () => authSdk.signOut(auth),
    async exportAccountData() {
      if (!auth.currentUser) throw new Error('Logga in för att exportera kontot.');
      const token = await auth.currentUser.getIdToken();
      const endpoint = new URL(`https://europe-north1-${firebaseConfig.projectId}.cloudfunctions.net/exportAccountData`);
      endpoint.searchParams.set('_export', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(await response.text() || 'Kunde inte skapa kontoexporten.');
      return response.blob();
    },
    async deleteAccountData(localAttachmentIds = []) {
      const user = auth.currentUser;
      if (!user) throw new Error('Logga in för att radera kontot.');
      await authSdk.reauthenticateWithPopup(user, provider);
      const call = functionsSdk.httpsCallable(functions, 'deleteAccountData');
      const response = await call({});
      localStorage.removeItem('fordonsboken.v1');
      localStorage.removeItem(`fordonsboken.v1.${user.uid}`);
      const localAttachmentsDeleted = await deleteLocalAttachments(user.uid, localAttachmentIds).catch(() => false);
      await authSdk.signOut(auth);
      return { ...response.data, localAttachmentsDeleted };
    },
    async uploadAttachment(uid, eventId, file, attachmentId) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `users/${uid}/events/${eventId}/${attachmentId}-${safeName}`;
      const target = storageSdk.ref(storage, path);
      const uploaded = await storageSdk.uploadBytes(target, file, { contentType: file.type || 'application/octet-stream' });
      return { path: uploaded.ref.fullPath, name: file.name, type: file.type };
    },
    async downloadAttachment(path) {
      return storageSdk.getDownloadURL(storageSdk.ref(storage, path));
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
    async loadTransferredVehicles(uid) {
      if (auth.currentUser?.uid !== uid) throw new Error('Du kan bara läsa tidigare fordon för det inloggade kontot.');
      const membershipSnapshot = await firestoreSdk.getDocs(collectionRef('users/' + uid + '/vehicleMemberships'));
      const formerMemberships = membershipSnapshot.docs.filter(item => {
        const data = item.data();
        return data.active === false && data.role === 'former_owner';
      });
      return Promise.all(formerMemberships.map(async item => {
        const vehicleId = item.data().vehicleId || item.id;
        const [vehicleSnapshot, memberSnapshot, attachmentSnapshot] = await Promise.all([
          firestoreSdk.getDoc(docRef('vehicles/' + vehicleId)),
          firestoreSdk.getDoc(docRef('vehicles/' + vehicleId + '/members/' + uid)),
          firestoreSdk.getDocs(collectionRef('users/' + uid + '/privateVehicles/' + vehicleId + '/attachments')),
        ]);
        if (!vehicleSnapshot.exists() || !memberSnapshot.exists()
          || memberSnapshot.data().uid !== uid
          || memberSnapshot.data().active !== false
          || memberSnapshot.data().role !== 'former_owner') return null;
        const vehicleData = vehicleSnapshot.data();
        return {
          id: vehicleId,
          vehicle: { ...(vehicleData.vehicle || {}) },
          attachments: attachmentSnapshot.docs.map(file => {
            const data = file.data();
            return { id: file.id, name: data.name || 'Bilaga', type: data.type || '', storagePath: data.storagePath || data.path || '' };
          }).filter(file => file.storagePath),
        };
      })).then(items => items.filter(Boolean));
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
    async getTermsAcceptance(uid) {
      if (auth.currentUser?.uid !== uid) throw new Error('Du kan bara läsa villkorsgodkännandet för det inloggade kontot.');
      const snapshot = await firestoreSdk.getDoc(docRef(`users/${uid}/appData/termsAcceptance`));
      return snapshot.exists() ? snapshot.data() : null;
    },
    async recordTermsAcceptance(uid, version) {
      if (auth.currentUser?.uid !== uid) throw new Error('Du kan bara spara villkorsgodkännandet för det inloggade kontot.');
      await firestoreSdk.setDoc(docRef(`users/${uid}/appData/termsAcceptance`), {
        version,
        acceptedAt: firestoreSdk.serverTimestamp(),
      });
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
      await runSyncStep('kontoinställningar', () => firestoreSdk.setDoc(preferencesRef, {
        state: accountPreferences(state),
        schemaVersion: 2,
        updatedAt: firestoreSdk.serverTimestamp(),
      }));
      await runSyncStep('fordonsdata', () => persistVehicleModelPlan(uid, state));
    },
  };

  authSdk.getRedirectResult(auth).catch(error => {
    console.error('Google redirect-inloggningen misslyckades', error);
    signal('fordonsmappen-auth-error', { code: error.code });
  });

  authSdk.onAuthStateChanged(auth, async user => {
    if (user) {
      try {
        await authSdk.reload(user);
        await user.getIdToken(true);
      } catch (error) {
        console.warn('Kunde inte uppdatera autentiseringsstatusen', error);
      }
    }
    if (auth.currentUser?.uid !== user?.uid) return;
    signal('fordonsmappen-auth', {
      user: user ? { uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL, emailVerified: user.emailVerified, providerData: user.providerData.map(({ providerId }) => ({ providerId })) } : null,
    });
  });
  signal('fordonsmappen-firebase-ready', { configured: true });
}
