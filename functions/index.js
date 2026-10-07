import { createHash, randomBytes } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (getApps().length === 0) initializeApp();
const db = getFirestore();
const TRANSFER_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CODE_PATTERN = /^[A-F0-9]{32}$/;

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
    const activeHistoryQuery = db.collection(`vehicles/${vehicleId}/ownershipHistory`)
      .where('ownerUid', '==', sellerUid);

    const [vehicleSnapshot, sellerMemberSnapshot, buyerMemberSnapshot, sellerIndexSnapshot,
      activeHistorySnapshot, buyerMigrationMarkerSnapshot, buyerLegacyStateSnapshot] = await Promise.all([
      transaction.get(vehicleRef),
      transaction.get(sellerMemberRef),
      transaction.get(buyerMemberRef),
      transaction.get(sellerIndexRef),
      transaction.get(activeHistoryQuery),
      transaction.get(buyerMigrationMarkerRef),
      transaction.get(buyerLegacyStateRef),
    ]);

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

    return { vehicleId, alreadyAccepted: false };
  });

  if (result.expired) throw new HttpsError('deadline-exceeded', 'Överföringskoden har gått ut.');
  return result;
});
