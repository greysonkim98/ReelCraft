import assert from 'node:assert/strict';
import { createFirestoreProjectStore } from '../backend/dist/services/projects.js';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, describe, it } from 'node:test';
import process from 'node:process';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, setDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';

// Fixed demo project and loopback endpoint: never run fixtures against a real database.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085') {
  throw new Error('Run npm run test:rules against the isolated loopback demo emulator.');
}
let environment;
const db = (uid) => environment.authenticatedContext(uid).firestore();
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-reelcraft-security',
    firestore: { host: '127.0.0.1', port: 8085, rules: await readFile('firestore.rules', 'utf8') },
  });
});
after(async () => { await environment?.cleanup(); });
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await Promise.all([
      setDoc(doc(store, 'users/alice'), { role: 'user' }),
      setDoc(doc(store, 'users/bob'), { role: 'admin' }),
      setDoc(doc(store, 'projects/alice-project'), { uid: 'alice' }),
      setDoc(doc(store, 'projects/bob-project'), { uid: 'bob' }),
      setDoc(doc(store, 'aiUsage/alice-entry'), { uid: 'alice' }),
      setDoc(doc(store, 'dailyStats/global_fixture'), { count: 1 }),
    ]);
  });
});
const profile = (patch) => environment.withSecurityRulesDisabled((context) =>
  updateDoc(doc(context.firestore(), 'users/alice'), patch));

describe('Firestore authorization', () => {
  it('allows active owner reads and owner-filtered project queries', async () => {
    for (const path of ['users/alice', 'projects/alice-project', 'aiUsage/alice-entry'])
      await assertSucceeds(getDoc(doc(db('alice'), path)));
    await assertSucceeds(getDocs(query(collection(db('alice'), 'projects'), where('uid', '==', 'alice'))));
  });
  it('denies public lists and reads', async () => {
    const store = environment.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(store, 'projects')));
    await assertFails(getDoc(doc(store, 'projects/alice-project')));
  });
  it('denies cross-account reads and unscoped queries even to admins', async () => {
    await assertFails(getDoc(doc(db('alice'), 'users/bob')));
    await assertFails(getDoc(doc(db('bob'), 'projects/alice-project')));
    await assertFails(getDoc(doc(db('bob'), 'aiUsage/alice-entry')));
    await assertFails(getDocs(collection(db('alice'), 'projects')));
  });
  for (const [name, patch] of [
    ['timestamp suspension', { suspendedUntil: Timestamp.fromMillis(Date.now() + 3600000) }],
    ['numeric suspension', { suspendedUntil: Date.now() + 3600000 }],
    ['timestamp deactivation', { deletedAt: Timestamp.now() }],
    ['numeric deactivation', { deletedAt: Date.now() }],
    ['malformed suspension', { suspendedUntil: 'invalid' }],
  ]) {
    it(`denies own reads after ${name}`, async () => {
      await profile(patch);
      for (const path of ['users/alice', 'projects/alice-project', 'aiUsage/alice-entry'])
        await assertFails(getDoc(doc(db('alice'), path)));
    });
  }
  it('allows expired suspension and restored nullable status fields', async () => {
    for (const suspendedUntil of [Date.now() - 60000, Timestamp.fromMillis(Date.now() - 60000), null]) {
      await profile({ suspendedUntil, deletedAt: null });
      await assertSucceeds(getDoc(doc(db('alice'), 'projects/alice-project')));
    }
  });
  it('denies orphaned account reads', async () => {
    await environment.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), 'users/alice')));
    await assertFails(getDoc(doc(db('alice'), 'projects/alice-project')));
  });
  it('denies all client writes, ownership changes and privilege escalation', async () => {
    for (const uid of ['alice', 'bob']) {
      const store = db(uid);
      await assertFails(setDoc(doc(store, `users/${uid}`), { role: 'admin' }));
      await assertFails(setDoc(doc(store, 'projects/new-project'), { uid }));
      await assertFails(updateDoc(doc(store, 'projects/alice-project'), { uid, extra: 'x'.repeat(100000) }));
      await assertFails(deleteDoc(doc(store, 'projects/alice-project')));
      await assertFails(setDoc(doc(store, 'dailyStats/global_fixture'), { count: -1 }));
    }
  });
  it('denies server-only paths and subcollections', async () => {
    for (const path of ['dailyStats/global_fixture', 'runtimeConfig/limits', 'adminAudit/event', 'ipStats/fixture', 'users/alice/private/secret'])
      await assertFails(getDoc(doc(db('alice'), path)));
  });
});


describe('server persistence safety', () => {
  it('never recreates a deleted project through patch or progress updates', async () => {
    const store = createFirestoreProjectStore('demo-reelcraft-security');
    await store.remove('alice-project');
    await assert.rejects(store.update('alice-project', { title: 'late update' }));
    await assert.rejects(store.setStage('alice-project', 'done', 100));
    assert.equal(await store.get('alice-project'), null);
  });
});
