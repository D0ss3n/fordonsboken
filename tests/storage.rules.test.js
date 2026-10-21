import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-fordonsmappen-rules';
const image = new Uint8Array([137, 80, 78, 71]);
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    storage: { rules: await readFile('storage.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearStorage();
});

function verifiedUser(uid) {
  return env.authenticatedContext(uid, { email_verified: true }).storage();
}

test('an account can upload, read, and delete its own profile image', async () => {
  const storage = verifiedUser('alice');
  const imageRef = ref(storage, 'users/alice/profile/avatar.png');

  await assertSucceeds(uploadBytes(imageRef, image, { contentType: 'image/png' }));
  await assertSucceeds(getBytes(imageRef));
  await assertSucceeds(deleteObject(imageRef));
});

test('a different account cannot read, overwrite, or delete another account file', async () => {
  const aliceRef = ref(verifiedUser('alice'), 'users/alice/events/service-1/receipt.pdf');
  await env.withSecurityRulesDisabled(async context => {
    await uploadBytes(
      ref(context.storage(), 'users/alice/events/service-1/receipt.pdf'),
      new Uint8Array([37, 80, 68, 70]),
      { contentType: 'application/pdf' },
    );
  });

  const bobRef = ref(verifiedUser('bob'), 'users/alice/events/service-1/receipt.pdf');
  await assertSucceeds(getBytes(aliceRef));
  await assertFails(getBytes(bobRef));
  await assertFails(uploadBytes(bobRef, image, { contentType: 'image/png' }));
  await assertFails(deleteObject(bobRef));
});

test('anonymous and unverified accounts cannot access Storage files', async () => {
  const filePath = 'users/alice/profile/avatar.png';
  await env.withSecurityRulesDisabled(async context => {
    await uploadBytes(ref(context.storage(), filePath), image, { contentType: 'image/png' });
  });

  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), filePath)));
  await assertFails(getBytes(ref(env.authenticatedContext('alice', { email_verified: false }).storage(), filePath)));
});

test('profile and event files enforce size and MIME type limits', async () => {
  const storage = verifiedUser('alice');
  const invalidProfileType = ref(storage, 'users/alice/profile/not-an-image.pdf');
  const invalidEventType = ref(storage, 'users/alice/events/service-1/not-a-file.exe');
  const oversizedProfile = ref(storage, 'users/alice/profile/large.png');
  const oversizedEvent = ref(storage, 'users/alice/events/service-1/large.pdf');

  await assertFails(uploadBytes(invalidProfileType, image, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(invalidEventType, image, { contentType: 'application/octet-stream' }));
  await assertFails(uploadBytes(oversizedProfile, new Uint8Array(5 * 1024 * 1024), { contentType: 'image/png' }));
  await assertFails(uploadBytes(oversizedEvent, new Uint8Array(10 * 1024 * 1024), { contentType: 'application/pdf' }));
});
