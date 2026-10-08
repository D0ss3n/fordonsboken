import { createHash, randomBytes } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { finished } from 'node:stream/promises';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const adminAuth = getAuth();
const bucket = getStorage().bucket();
const TRANSFER_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TRANSFER_RETENTION_MS = 29 * 24 * 60 * 60 * 1000;
const LEGACY_TRANSFER_RETENTION_MS = (28 * 24 + 12) * 60 * 60 * 1000;
const CODE_PATTERN = /^[A-F0-9]{32}$/;
const PUBLIC_EVENT_LIMIT = 500;
const PUBLIC_CATEGORIES = new Set([
  'Service', 'Reparation', 'Problem', 'Underhåll', 'Besiktning', 'Däck', 'Kostnad', 'Dokument', 'Annat',
]);

setGlobalOptions({ region: 'europe-north1', maxInstances: 3 });

function requireUid(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Logga in för att överföra fordon.');
  return request.auth.uid;
}

function requireVehicleId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'Fordonets ID är ogiltigt.');
  }
  return value;
}

function normalizeCode(value) {
  const code = typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '';
  if (!CODE_PATTERN.test(code)) throw new HttpsError('invalid-argument', 'Överföringskoden har fel format.');
  return code;
}

function codeHash(code) {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

function publicText(value, maxLength, label, required = false) {
  if (typeof value !== 'string') {
    if (required) throw new HttpsError('invalid-argument', `${label} saknas.`);
    return '';
  }
  const result = value.trim().slice(0, maxLength);
  if (required && !result) throw new HttpsError('invalid-argument', `${label} saknas.`);
  return result;
}

function publicNumber(value, label, required = false) {
  if (value == null && !required) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) {
    throw new HttpsError('invalid-argument', `${label} är ogiltigt.`);
  }
  return result;
}

function sanitizePublicSnapshot(input) {
  if (!input || typeof input !== 'object' || !input.vehicle || typeof input.vehicle !== 'object'
    || !Array.isArray(input.events) || input.events.length > PUBLIC_EVENT_LIMIT) {
    throw new HttpsError('invalid-argument', 'Delningsprofilen har ett ogiltigt format.');
  }
  const vehicle = {
    name: publicText(input.vehicle.name, 80, 'Fordonsnamn', true),
    type: publicText(input.vehicle.type, 40, 'Fordonstyp'),
    make: publicText(input.vehicle.make, 60, 'Märke'),
    model: publicText(input.vehicle.model, 60, 'Modell'),
    year: publicText(input.vehicle.year, 4, 'Årsmodell'),
    mileage: publicNumber(input.vehicle.mileage, 'Miltal', true),
  };
  const events = input.events.map(event => {
    if (!event || typeof event !== 'object' || !PUBLIC_CATEGORIES.has(event.category)) {
      throw new HttpsError('invalid-argument', 'En historikpost har ogiltig kategori.');
    }
    const date = publicText(event.date, 10, 'Datum', true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpsError('invalid-argument', 'En historikpost har ogiltigt datum.');
    }
    return {
      category: event.category,
      title: publicText(event.title, 160, 'Händelserubrik', true),
      date,
      mileage: publicNumber(event.mileage, 'Händelsens miltal'),
      sourceType: ['owner_entry', 'receipt', 'document', 'workshop', 'imported'].includes(event.sourceType)
        ? event.sourceType
        : 'owner_entry',
    };
  });
  return { schemaVersion: 2, vehicle, events, updatedAt: Timestamp.now() };
}

function activeOwner(memberSnapshot, uid) {
  return memberSnapshot.exists
    && memberSnapshot.data().uid === uid
    && memberSnapshot.data().active === true
    && memberSnapshot.data().role === 'owner';
}

function exportValue(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Buffer.isBuffer(value)) return { encoding: 'base64', data: value.toString('base64') };
  if (Array.isArray(value)) return value.map(exportValue);
  if (value && typeof value === 'object') {
    if (typeof value.path === 'string' && typeof value.get === 'function') return { documentPath: value.path };
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return { latitude: value.latitude, longitude: value.longitude };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, exportValue(item)]));
  }
  return value;
}

async function collectUserDocuments(uid) {
  const documents = [];
  const seen = new Set();
  const add = (snapshot, include = true) => {
    if (!snapshot.exists || seen.has(snapshot.ref.path)) return;
    seen.add(snapshot.ref.path);
    if (include) documents.push({ path: snapshot.ref.path, data: exportValue(snapshot.data()) });
  };
  const userRoot = db.doc(`users/${uid}`);
  const walk = async ref => {
    const snapshot = await ref.get();
    add(snapshot);
    const collections = await ref.listCollections();
    for (const collection of collections) {
      const page = await collection.get();
      for (const child of page.docs) await walk(child.ref);
    }
  };
  await walk(userRoot);

  const membershipSnapshot = await db.collection(`users/${uid}/vehicleMemberships`).get();
  for (const membership of membershipSnapshot.docs) {
    const vehicleId = membership.data().vehicleId || membership.id;
    const vehicleRef = db.doc(`vehicles/${vehicleId}`);
    const [vehicleSnapshot, memberSnapshot] = await Promise.all([
      vehicleRef.get(), db.doc(`vehicles/${vehicleId}/members/${uid}`).get(),
    ]);
    add(vehicleSnapshot);
    add(memberSnapshot);
    const isActive = memberSnapshot.exists && memberSnapshot.data().active === true;
    for (const [collectionName, ownerField] of [['events', 'createdByUid'], ['problems', 'createdByUid']]) {
      const collection = vehicleRef.collection(collectionName);
      const records = isActive
        ? await collection.get()
        : await collection.where(ownerField, '==', uid).get();
      records.docs.forEach(snapshot => add(snapshot));
    }
    const ownership = await vehicleRef.collection('ownershipHistory').where('ownerUid', '==', uid).get();
    ownership.docs.forEach(snapshot => add(snapshot));
  }

  const [createdTransfers, acceptedTransfers] = await Promise.all([
    db.collection('transferRequests').where('fromUid', '==', uid).get(),
    db.collection('transferRequests').where('acceptedByUid', '==', uid).get(),
  ]);
  [...createdTransfers.docs, ...acceptedTransfers.docs].forEach(snapshot => add(snapshot));

  const mappings = await db.collection(`users/${uid}/publicShareMappings`).get();
  for (const mapping of mappings.docs) {
    const token = mapping.data().token;
    if (typeof token !== 'string') continue;
    add(await db.doc(`publicVehicles/${token}`).get());
  }
  return documents;
}

export const exportAccountData = onRequest({
  region: 'europe-north1',
  cors: true,
  timeoutSeconds: 540,
  memory: '1GiB',
}, async (request, response) => {
  response.set('Cache-Control', 'no-store, private');
  if (request.method !== 'GET') {
    response.set('Allow', 'GET').status(405).send('Method not allowed.');
    return;
  }
  const authorization = request.get('Authorization') || '';
  const match = authorization.match(/^Bearer (.+)$/);
  if (!match) {
    response.status(401).send('Logga in för att exportera kontodata.');
    return;
  }

  let uid;
  try {
    uid = (await adminAuth.verifyIdToken(match[1])).uid;
  } catch {
    response.status(401).send('Inloggningen har gått ut. Logga in igen och försök på nytt.');
    return;
  }

  try {
    const user = await adminAuth.getUser(uid);
    const documents = await collectUserDocuments(uid);
    const [files] = await bucket.getFiles({ prefix: `users/${uid}/events/` });
    response.set('Content-Type', 'application/gzip');
    response.set('Content-Disposition', 'attachment; filename="fordonsmappen-kontoexport.json.gz"');
    const gzip = createGzip();
    gzip.pipe(response);
    const write = chunk => new Promise((resolve, reject) => {
      gzip.write(chunk, error => error ? reject(error) : resolve());
    });
    await write(JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      account: {
        uid,
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
        createdAt: user.metadata.creationTime || null,
      },
      documents,
    }).slice(0, -1) + ',"files":[');
    let first = true;
    for (const file of files) {
      if (!first) await write(',');
      first = false;
      const [contents] = await file.download();
      await write(JSON.stringify({
        path: file.name,
        name: file.name.split('/').at(-1),
        contentType: file.metadata.contentType || 'application/octet-stream',
        contentBase64: contents.toString('base64'),
      }));
    }
    await write(']}');
    gzip.end();
    await finished(gzip);
  } catch (error) {
    console.error('Kunde inte skapa kontoexport', { uid, message: error?.message });
    if (!response.headersSent) response.status(500).send('Kunde inte skapa exporten. Försök igen senare.');
    else response.end();
  }
});

export const deleteAccountData = onCall(async request => {
  const uid = requireUid(request);
  const authTime = Number(request.auth.token.auth_time || 0) * 1000;
  if (!authTime || Date.now() - authTime > 5 * 60 * 1000) {
    throw new HttpsError('failed-precondition', 'Logga in igen innan kontot raderas.');
  }

  await adminAuth.revokeRefreshTokens(uid);
  const membershipSnapshot = await db.collection(`users/${uid}/vehicleMemberships`).get();
  const memberSnapshots = await db.collectionGroup('members').where('uid', '==', uid).get();
  const vehicleIds = new Set([
    ...membershipSnapshot.docs.map(doc => doc.data().vehicleId || doc.id),
    ...memberSnapshots.docs.map(doc => doc.ref.parent.parent?.id).filter(Boolean),
  ]);

  const mappings = await db.collection(`users/${uid}/publicShareMappings`).get();
  for (const mapping of mappings.docs) {
    const token = mapping.data().token;
    if (typeof token === 'string') await db.doc(`publicVehicles/${token}`).delete();
  }

  const removedVehicleCount = [];
  for (const vehicleId of vehicleIds) {
    const vehicleRef = db.doc(`vehicles/${vehicleId}`);
    const [vehicleSnapshot, members] = await Promise.all([
      vehicleRef.get(), vehicleRef.collection('members').get(),
    ]);
    const survivingMembers = members.docs.filter(doc => doc.id !== uid && doc.data().active === true);
    if (!survivingMembers.length) {
      for (const member of members.docs) {
        await db.doc(`users/${member.id}/vehicleMemberships/${vehicleId}`).delete().catch(() => {});
      }
      await db.recursiveDelete(vehicleRef);
      removedVehicleCount.push(vehicleId);
      continue;
    }

    const [events, problems, ownership] = await Promise.all([
      vehicleRef.collection('events').where('createdByUid', '==', uid).get(),
      vehicleRef.collection('problems').where('createdByUid', '==', uid).get(),
      vehicleRef.collection('ownershipHistory').where('ownerUid', '==', uid).get(),
    ]);
    const updates = [
      ...[...events.docs, ...problems.docs].map(doc => ({ ref: doc.ref, data: { createdByUid: FieldValue.delete() } })),
      ...ownership.docs.map(doc => ({ ref: doc.ref, delete: true })),
      { ref: vehicleRef.collection('members').doc(uid), delete: true },
      { ref: db.doc(`users/${uid}/vehicleMemberships/${vehicleId}`), delete: true },
    ];
    if (vehicleSnapshot.exists && vehicleSnapshot.data().createdByUid === uid) {
      updates.push({ ref: vehicleRef, data: { createdByUid: FieldValue.delete() } });
    }
    for (let offset = 0; offset < updates.length; offset += 400) {
      const batch = db.batch();
      for (const update of updates.slice(offset, offset + 400)) {
        if (update.delete) batch.delete(update.ref);
        else batch.update(update.ref, update.data);
      }
      await batch.commit();
    }
  }

  const [createdTransfers, acceptedTransfers] = await Promise.all([
    db.collection('transferRequests').where('fromUid', '==', uid).get(),
    db.collection('transferRequests').where('acceptedByUid', '==', uid).get(),
  ]);
  const transferRefs = new Map([...createdTransfers.docs, ...acceptedTransfers.docs]
    .map(doc => [doc.ref.path, doc.ref]));
  for (const ref of transferRefs.values()) await ref.delete();

  await bucket.deleteFiles({ prefix: `users/${uid}/events/` });
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await adminAuth.deleteUser(uid);
  return { deleted: true, removedVehicleCount: removedVehicleCount.length };
});

export const publishPublicVehicle = onCall(async request => {
  const uid = requireUid(request);
  const vehicleId = requireVehicleId(request.data?.vehicleId);
  const snapshot = sanitizePublicSnapshot(request.data?.snapshot);
  const vehicleRef = db.doc(`vehicles/${vehicleId}`);
  const memberRef = db.doc(`vehicles/${vehicleId}/members/${uid}`);
  const mappingRef = db.doc(`users/${uid}/publicShareMappings/${vehicleId}`);
  const legacyShareRef = db.doc(`publicVehicles/${vehicleId}`);

  const token = await db.runTransaction(async transaction => {
    const [vehicleSnapshot, memberSnapshot, mappingSnapshot] = await Promise.all([
      transaction.get(vehicleRef), transaction.get(memberRef), transaction.get(mappingRef),
    ]);
    if (!vehicleSnapshot.exists || !activeOwner(memberSnapshot, uid)) {
      throw new HttpsError('permission-denied', 'Bara en aktiv fordonsägare kan publicera profilen.');
    }
    const shareToken = mappingSnapshot.exists && typeof mappingSnapshot.data().token === 'string'
      ? mappingSnapshot.data().token
      : randomBytes(24).toString('base64url');
    const publicShareRef = db.doc(`publicVehicles/${shareToken}`);
    const [publicShareSnapshot, legacyShareSnapshot] = await Promise.all([
      transaction.get(publicShareRef),
      transaction.get(legacyShareRef),
    ]);
    transaction.set(mappingRef, { schemaVersion: 1, token: shareToken, vehicleId, ownerUid: uid });
    transaction.set(publicShareRef, snapshot);
    if (vehicleId !== shareToken && legacyShareSnapshot.exists) transaction.delete(legacyShareRef);
    // If a stale/corrupt mapping points elsewhere, remove its old public snapshot too.
    const priorToken = mappingSnapshot.data()?.token;
    if (mappingSnapshot.exists && priorToken !== shareToken && typeof priorToken === 'string') {
      transaction.delete(db.doc(`publicVehicles/${priorToken}`));
    }
    return shareToken;
  });
  return { shareToken: token };
});

export const revokePublicVehicleShare = onCall(async request => {
  const uid = requireUid(request);
  const vehicleId = requireVehicleId(request.data?.vehicleId);
  const vehicleRef = db.doc(`vehicles/${vehicleId}`);
  const memberRef = db.doc(`vehicles/${vehicleId}/members/${uid}`);
  const mappingRef = db.doc(`users/${uid}/publicShareMappings/${vehicleId}`);
  const legacyShareRef = db.doc(`publicVehicles/${vehicleId}`);

  await db.runTransaction(async transaction => {
    const [vehicleSnapshot, memberSnapshot, mappingSnapshot] = await Promise.all([
      transaction.get(vehicleRef), transaction.get(memberRef), transaction.get(mappingRef),
    ]);
    if (!vehicleSnapshot.exists || !activeOwner(memberSnapshot, uid)) {
      throw new HttpsError('permission-denied', 'Bara en aktiv fordonsägare kan återkalla profilen.');
    }
    const shareRef = mappingSnapshot.exists && typeof mappingSnapshot.data().token === 'string'
      ? db.doc(`publicVehicles/${mappingSnapshot.data().token}`)
      : null;
    const shareSnapshot = shareRef ? await transaction.get(shareRef) : null;
    const legacySnapshot = vehicleId === mappingSnapshot.data()?.token
      ? null
      : await transaction.get(legacyShareRef);
    if (shareRef && shareSnapshot?.exists) transaction.delete(shareRef);
    if (legacySnapshot?.exists) transaction.delete(legacyShareRef);
    if (mappingSnapshot.exists) transaction.delete(mappingRef);
  });
  return { revoked: true };
});

export const createVehicleTransfer = onCall(async request => {
  const sellerUid = requireUid(request);
  const vehicleId = requireVehicleId(request.data?.vehicleId);
  const vehicleRef = db.doc(`vehicles/${vehicleId}`);
  const memberRef = db.doc(`vehicles/${vehicleId}/members/${sellerUid}`);
  const [vehicle, member] = await Promise.all([vehicleRef.get(), memberRef.get()]);

  if (!vehicle.exists || !member.exists
    || member.data().uid !== sellerUid
    || member.data().active !== true
    || member.data().role !== 'owner') {
    throw new HttpsError('permission-denied', 'Du är inte aktiv ägare av det här fordonet.');
  }

  const code = randomBytes(16).toString('hex').toUpperCase();
  const transferId = codeHash(code);
  const expiresAtMs = Date.now() + TRANSFER_LIFETIME_MS;
  await db.doc(`transferRequests/${transferId}`).create({
    schemaVersion: 1,
    vehicleId,
    fromUid: sellerUid,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    deleteAfter: Timestamp.fromMillis(expiresAtMs + TRANSFER_RETENTION_MS),
  });

  // The raw code is returned once. Firestore stores only its SHA-256 digest as the document ID.
  return { code, transferId, expiresAt: expiresAtMs };
});

export const acceptVehicleTransfer = onCall(async request => {
  const buyerUid = requireUid(request);
  const code = normalizeCode(request.data?.code);
  const transferId = codeHash(code);
  const requestRef = db.doc(`transferRequests/${transferId}`);

  const result = await db.runTransaction(async transaction => {
    const transferSnapshot = await transaction.get(requestRef);
    if (!transferSnapshot.exists) throw new HttpsError('not-found', 'Koden är ogiltig eller har gått ut.');
    const transfer = transferSnapshot.data();
    if (transfer.status === 'accepted' && transfer.acceptedByUid === buyerUid) {
      return { vehicleId: transfer.vehicleId, alreadyAccepted: true };
    }
    if (transfer.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Koden har redan använts eller återkallats.');
    }
    if (!(transfer.expiresAt instanceof Timestamp) || transfer.expiresAt.toMillis() <= Date.now()) {
      transaction.update(requestRef, { status: 'expired', expiredAt: FieldValue.serverTimestamp() });
      return { expired: true };
    }

    const vehicleId = requireVehicleId(transfer.vehicleId);
    const sellerUid = transfer.fromUid;
    if (typeof sellerUid !== 'string' || sellerUid === buyerUid) {
      throw new HttpsError('failed-precondition', 'Överföringskoden kan inte användas av detta konto.');
    }

    const vehicleRef = db.doc(`vehicles/${vehicleId}`);
    const sellerMemberRef = db.doc(`vehicles/${vehicleId}/members/${sellerUid}`);
    const buyerMemberRef = db.doc(`vehicles/${vehicleId}/members/${buyerUid}`);
    const sellerIndexRef = db.doc(`users/${sellerUid}/vehicleMemberships/${vehicleId}`);
    const buyerIndexRef = db.doc(`users/${buyerUid}/vehicleMemberships/${vehicleId}`);
    const buyerMigrationMarkerRef = db.doc(`users/${buyerUid}/migrationStatus/vehicleModelV2`);
    const buyerLegacyStateRef = db.doc(`users/${buyerUid}/appData/primary`);
    const publicVehicleRef = db.doc(`publicVehicles/${vehicleId}`);
    const sellerShareMappingRef = db.doc(`users/${sellerUid}/publicShareMappings/${vehicleId}`);
    const activeHistoryQuery = db.collection(`vehicles/${vehicleId}/ownershipHistory`)
      .where('ownerUid', '==', sellerUid);

    const [vehicleSnapshot, sellerMemberSnapshot, buyerMemberSnapshot, sellerIndexSnapshot,
      activeHistorySnapshot, buyerMigrationMarkerSnapshot, buyerLegacyStateSnapshot,
      sellerShareMappingSnapshot] = await Promise.all([
      transaction.get(vehicleRef),
      transaction.get(sellerMemberRef),
      transaction.get(buyerMemberRef),
      transaction.get(sellerIndexRef),
      transaction.get(activeHistoryQuery),
      transaction.get(buyerMigrationMarkerRef),
      transaction.get(buyerLegacyStateRef),
      transaction.get(sellerShareMappingRef),
    ]);

    const sellerPublicShareRef = sellerShareMappingSnapshot.exists
      && typeof sellerShareMappingSnapshot.data().token === 'string'
      ? db.doc(`publicVehicles/${sellerShareMappingSnapshot.data().token}`)
      : null;
    if (sellerPublicShareRef) await transaction.get(sellerPublicShareRef);

    if (!vehicleSnapshot.exists
      || !sellerMemberSnapshot.exists
      || sellerMemberSnapshot.data().uid !== sellerUid
      || sellerMemberSnapshot.data().active !== true
      || sellerMemberSnapshot.data().role !== 'owner'
      || !sellerIndexSnapshot.exists
      || sellerIndexSnapshot.data().active !== true) {
      throw new HttpsError('failed-precondition', 'Säljaren är inte längre aktiv ägare av fordonet.');
    }
    if (buyerMemberSnapshot.exists && buyerMemberSnapshot.data().active === true) {
      throw new HttpsError('already-exists', 'Ditt konto har redan åtkomst till fordonet.');
    }

    const activeHistory = activeHistorySnapshot.docs.filter(doc => doc.data().endedAt == null);
    if (activeHistory.length === 0) {
      throw new HttpsError('failed-precondition', 'Fordonets aktiva ägarhistorik saknas; överföringen stoppades.');
    }

    const now = Timestamp.now();
    const ownershipHistoryId = `transfer-${transferId}`;
    const newHistoryRef = db.doc(`vehicles/${vehicleId}/ownershipHistory/${ownershipHistoryId}`);
    transaction.update(sellerMemberRef, { active: false, role: 'former_owner' });
    transaction.update(sellerIndexRef, { active: false, role: 'former_owner' });
    transaction.set(buyerMemberRef, {
      schemaVersion: 2,
      uid: buyerUid,
      role: 'owner',
      active: true,
      startedAt: now,
      ownershipHistoryId,
    });
    transaction.set(buyerIndexRef, {
      schemaVersion: 2,
      vehicleId,
      role: 'owner',
      active: true,
    });
    activeHistory.forEach(doc => transaction.update(doc.ref, { endedAt: now }));
    transaction.create(newHistoryRef, {
      schemaVersion: 2,
      ownerUid: buyerUid,
      startedAt: now,
      endedAt: null,
      source: 'app-transfer',
    });
    transaction.update(requestRef, {
      status: 'accepted',
      acceptedByUid: buyerUid,
      acceptedAt: now,
      deleteAfter: Timestamp.fromMillis(now.toMillis() + TRANSFER_RETENTION_MS),
    });
    // A completely new buyer may have no legacy blob to trigger its normal migration.
    // Mark its transferred v2 membership ready, but leave legacy accounts to migrate first.
    if ((!buyerMigrationMarkerSnapshot.exists || buyerMigrationMarkerSnapshot.data().complete !== true)
      && !buyerLegacyStateSnapshot.exists) {
      transaction.set(buyerMigrationMarkerRef, {
        schemaVersion: 2,
        sourceSchemaVersion: 0,
        complete: true,
        counts: { transferredVehicles: 1 },
        vehicleCount: 1,
        completedAt: now,
      });
    }
    // A seller's public snapshot must not stay live or be republished by the former owner.
    transaction.delete(publicVehicleRef);
    if (sellerPublicShareRef) transaction.delete(sellerPublicShareRef);
    if (sellerShareMappingSnapshot.exists) transaction.delete(sellerShareMappingRef);

    return { vehicleId, alreadyAccepted: false };
  });

  if (result.expired) throw new HttpsError('deadline-exceeded', 'Överföringskoden har gått ut.');
  return result;
});

export const purgeExpiredVehicleTransfers = onSchedule({
  schedule: 'every 6 hours',
  timeZone: 'UTC',
  timeoutSeconds: 540,
}, async () => {
  const now = Timestamp.now();
  const dueQuery = db.collection('transferRequests')
    .where('deleteAfter', '<=', now)
    .orderBy('deleteAfter');
  const legacyCutoff = Timestamp.fromMillis(now.toMillis() - LEGACY_TRANSFER_RETENTION_MS);
  const legacyQuery = db.collection('transferRequests')
    .where('expiresAt', '<=', legacyCutoff)
    .orderBy('expiresAt');

  async function purge(query, legacyOnly = false) {
    let cursor = null;
    let deleted = 0;
    while (true) {
      let pageQuery = query.limit(400);
      if (cursor) pageQuery = pageQuery.startAfter(cursor);
      const page = await pageQuery.get();
      if (page.empty) break;

      const writer = db.bulkWriter();
      for (const transfer of page.docs) {
        if (!legacyOnly || !(transfer.data().deleteAfter instanceof Timestamp)) {
          writer.delete(transfer.ref);
          deleted += 1;
        }
      }
      await writer.close();
      cursor = page.docs[page.docs.length - 1];
      if (page.docs.length < 400) break;
    }
    return deleted;
  }

  const [newTransfers, legacyTransfers] = await Promise.all([
    purge(dueQuery),
    purge(legacyQuery, true),
  ]);
  console.info('Purged expired vehicle transfer documents', {
    newTransfers,
    legacyTransfers,
  });
});
