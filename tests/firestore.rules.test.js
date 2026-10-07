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
  ownerUid: 'alice',
  vehicle: { name: 'Min bil' },
  events: [],
  updatedAt: Date.now(),
};
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

after(async () => {
  await env?.cleanup();
});

test('an owner can publish, update, and remove their share', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  const ref = doc(alice, sharePath);

  await assertSucceeds(setDoc(ref, shareData));
  await assertSucceeds(updateDoc(ref, { updatedAt: Date.now() }));
  await assertSucceeds(deleteDoc(ref));
});

test('a share link can read one shared document, but cannot list shares', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), sharePath), shareData);
  });

  const visitor = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(visitor, sharePath)));
  await assertFails(getDocs(collection(visitor, 'publicVehicles')));
});

test('another account cannot take over, edit, or delete an owner share', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), sharePath), shareData);
  });

  const bob = env.authenticatedContext('bob').firestore();
  const ref = doc(bob, sharePath);
  await assertFails(updateDoc(ref, { ownerUid: 'bob' }));
  await assertFails(updateDoc(ref, { 'vehicle.name': 'Övertagen bil' }));
  await assertFails(deleteDoc(ref));
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

test('share documents reject fields outside the explicit top-level allowlist', async () => {
  const alice = env.authenticatedContext('alice').firestore();
  await assertFails(setDoc(doc(alice, sharePath), {
    ...shareData,
    email: 'private@example.com',
  }));
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
