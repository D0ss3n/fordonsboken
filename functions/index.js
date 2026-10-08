import { createHash, randomBytes } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const TRANSFER_LIFETIME_MS = 24 * 60 * 60 * 1000;
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
