import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const projectId = 'demo-fordonsmappen-rules';
const sharePath = 'publicVehicles/car-share-token';
const shareData = {
  schemaVersion: 2,
  vehicle: { name: 'Min bil', type: 'Bil', make: 'Volvo', model: 'V60', year: '2015', mileage: 18420 },
  events: [{ category: 'Service', title: 'Service utförd', date: '2026-01-02', mileage: 18000, sourceType: 'owner_entry' }],
  updatedAt: Date.now(),
};
const legacyShareData = { ...shareData, ownerUid: 'alice', vehicle: { ...shareData.vehicle, registration: 'ABC123' } };
const vehicleId = 'legacy-car-1';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

async function seedActiveOwner(uid, id = vehicleId) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, `vehicles/${id}`), {
      schemaVersion: 2, createdByUid: uid, vehicle: { id, name: 'Testbil' },
    });
    await setDoc(doc(db, `vehicles/${id}/members/${uid}`), {
      schemaVersion: 2, uid, role: 'owner', active: true, startedAt: null,
    });
  });
}

after(async () => {
  await env?.cleanup();
});

test('public links read sanitized token documents but not legacy owner-ID shares', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, sharePath), shareData);
    await setDoc(doc(db, 'publicVehicles/legacy-car-1'), legacyShareData);
  });

  const visitor = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(visitor, sharePath)));
  await assertFails(getDoc(doc(visitor, 'publicVehicles/legacy-car-1')));
  await assertFails(getDocs(collection(visitor, 'publicVehicles')));
});

test('clients cannot publish, edit, or revoke public profiles directly', async () => {
  await seedActiveOwner('alice');
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), sharePath), shareData);
  });
  const alice = env.authenticatedContext('alice').firestore();
  const ref = doc(alice, sharePath);
  await assertFails(setDoc(doc(alice, 'publicVehicles/another-token'), shareData));
  await assertFails(updateDoc(ref, { updatedAt: Date.now() }));
  await assertFails(deleteDoc(ref));
  await assertFails(getDoc(doc(alice, 'users/alice/publicShareMappings/legacy-car-1')));
});

test('private account data remains inaccessible to a different account', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/alice/appData/primary'), {
      state: { vehicles: [{ id: 'private-car' }] },
    });
  });

  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  await assertSucceeds(getDoc(doc(alice, 'users/alice/appData/primary')));
  await assertFails(getDoc(doc(bob, 'users/alice/appData/primary')));
});

test('legacy share documents containing vehicle or owner identifiers are not publicly readable', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), sharePath), legacyShareData);
  });
  const visitor = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(visitor, sharePath)));
});

test('a former owner cannot republish a vehicle after ownership changes', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, `vehicles/${vehicleId}`), {
      schemaVersion: 2, createdByUid: 'alice', vehicle: { id: vehicleId, name: 'Testbil' },
    });
    await setDoc(doc(db, `vehicles/${vehicleId}/members/alice`), {
      schemaVersion: 2, uid: 'alice', role: 'former_owner', active: false, startedAt: null,
    });
    await setDoc(doc(db, `vehicles/${vehicleId}/members/bob`), {
      schemaVersion: 2, uid: 'bob', role: 'owner', active: true, startedAt: null,
    });
  });

  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  await assertFails(setDoc(doc(alice, sharePath), shareData));
  await assertFails(setDoc(doc(bob, sharePath), shareData));
});

test('v2 owner bootstrap, vehicle facts, and private data follow separate access rules', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const batch = writeBatch(alice);
  batch.set(doc(alice, `vehicles/${vehicleId}`), {
    schemaVersion: 2,
    createdByUid: 'alice',
    vehicle: { id: vehicleId, name: 'Familjebilen', registration: 'ABC123', mileage: 18420 },
  });
  batch.set(doc(alice, `vehicles/${vehicleId}/members/alice`), {
    schemaVersion: 2, uid: 'alice', role: 'owner', active: true, startedAt: null,
  });
  batch.set(doc(alice, `users/alice/vehicleMemberships/${vehicleId}`), {
    schemaVersion: 2, vehicleId, role: 'owner', active: true,
  });
  batch.set(doc(alice, `vehicles/${vehicleId}/ownershipHistory/legacy-alice`), {
    schemaVersion: 2, ownerUid: 'alice', startedAt: null, endedAt: null, source: 'legacy-migration',
  });
  await assertSucceeds(batch.commit());

  const event = {
    schemaVersion: 2, id: 'service-1', category: 'Service', title: 'Service utförd',
    date: '2026-01-02', mileage: 18000, sourceType: 'owner_entry', createdByUid: 'alice',
  };
  await assertSucceeds(setDoc(doc(alice, `vehicles/${vehicleId}/events/service-1`), event));
  await assertFails(setDoc(doc(alice, `vehicles/${vehicleId}/events/unverified-claim`), {
    ...event, id: 'unverified-claim', sourceType: 'external_verified',
  }));
  await assertSucceeds(setDoc(doc(alice, `users/alice/privateVehicles/${vehicleId}/eventDetails/service-1`), {
    schemaVersion: 2, eventId: 'service-1', cost: 3200, description: 'Privat anteckning',
  }));

  const bob = env.authenticatedContext('bob').firestore();
  await assertFails(getDoc(doc(bob, `vehicles/${vehicleId}`)));
  await assertFails(getDoc(doc(bob, `users/alice/privateVehicles/${vehicleId}/eventDetails/service-1`)));
  await assertFails(setDoc(doc(bob, `vehicles/${vehicleId}/members/bob`), {
    schemaVersion: 2, uid: 'bob', role: 'owner', active: true, startedAt: null,
  }));
});

test('a future owner cannot rewrite a previous owner\'s v2 history event', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `vehicles/${vehicleId}`), {
      schemaVersion: 2, createdByUid: 'alice', vehicle: { id: vehicleId, name: 'Familjebilen' },
    });
    await setDoc(doc(context.firestore(), `vehicles/${vehicleId}/members/alice`), {
      schemaVersion: 2, uid: 'alice', role: 'owner', active: false, startedAt: null,
    });
    await setDoc(doc(context.firestore(), `vehicles/${vehicleId}/members/bob`), {
      schemaVersion: 2, uid: 'bob', role: 'owner', active: true, startedAt: '2026-02-01',
    });
    await setDoc(doc(context.firestore(), `vehicles/${vehicleId}/events/service-1`), {
      schemaVersion: 2, id: 'service-1', category: 'Service', title: 'Service utförd',
      date: '2026-01-02', mileage: 18000, sourceType: 'owner_entry', createdByUid: 'alice',
    });
  });

  const bob = env.authenticatedContext('bob').firestore();
  await assertSucceeds(getDoc(doc(bob, `vehicles/${vehicleId}/events/service-1`)));
  await assertFails(updateDoc(doc(bob, `vehicles/${vehicleId}/events/service-1`), { title: 'Ändrad historik' }));
  await assertFails(deleteDoc(doc(bob, `vehicles/${vehicleId}/events/service-1`)));
});
