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
} from 'firebase/firestore';

const projectId = 'demo-fordonsmappen-rules';
const sharePath = 'publicVehicles/car-share-token';
const shareData = {
  ownerUid: 'alice',
  vehicle: { name: 'Min bil' },
  events: [],
  updatedAt: Date.now(),
};

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
