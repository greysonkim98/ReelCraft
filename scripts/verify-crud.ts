/**
 * Checks users/projects CRUD against the REAL Firebase project (needs STORE=firestore and a running
 * backend). Signs in a throwaway test user through a custom token, then deletes everything it made.
 *
 *   npm run dev:backend        (in another terminal)
 *   npx tsx scripts/verify-crud.ts [http://localhost:4000]
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { parseServiceAccount } from '../backend/src/lib/firebase';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
// The web API key may live only in the frontend's env file; dotenv never overrides a non-empty value.
dotenv.config({ path: path.resolve(__dirname, '../frontend/.env.local') });
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = dotenv.parse(
    readFileSync(path.resolve(__dirname, '../frontend/.env.local')),
  ).NEXT_PUBLIC_FIREBASE_API_KEY;
}

const API = `${process.argv[2] ?? 'http://localhost:4000'}/api/v1`;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID!;
const WEB_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY!;
const OWNER = 'crud-test-owner';
const OTHER = 'crud-test-other';
const PROJECT = 'crud-test-project';

const key = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
initializeApp({ credential: cert({ projectId: PROJECT_ID, ...key }), projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${JSON.stringify(detail)}`}`);
};

async function idToken(uid: string): Promise<string> {
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`token exchange failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function call(token: string, method: string, route: string, body?: unknown) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text
      ? (JSON.parse(text) as {
          style?: unknown;
          title?: unknown;
          projects?: { id: string }[];
        })
      : null,
  };
}

const style = { color: 'warm', subtitle: 'pop', tempo: 'calm', quality: '720p' };

async function cleanup() {
  await db
    .collection('projects')
    .doc(PROJECT)
    .delete()
    .catch(() => undefined);
  for (const uid of [OWNER, OTHER]) {
    await db
      .collection('users')
      .doc(uid)
      .delete()
      .catch(() => undefined);
    await auth.deleteUser(uid).catch(() => undefined);
  }
}

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`backend is not reachable at ${API}`);

  const owner = await idToken(OWNER);
  const other = await idToken(OTHER);

  // users
  let r = await call(owner, 'POST', '/me/session');
  check('session creates the profile', r.status === 200, r);
  const userDoc = await db.collection('users').doc(OWNER).get();
  check(
    'users/{uid} exists in Firestore with createdAt',
    userDoc.exists && !!userDoc.data()?.createdAt,
  );

  r = await call(owner, 'PUT', '/me/style', { style });
  check('PUT /me/style', r.status === 204, r);
  check(
    'style stored in Firestore',
    JSON.stringify((await db.collection('users').doc(OWNER).get()).data()?.style) ===
      JSON.stringify(style),
  );

  r = await call(owner, 'POST', '/me/session');
  check(
    'session returns the saved style',
    JSON.stringify(r.body?.style) === JSON.stringify(style),
    r,
  );

  r = await call(owner, 'PUT', '/me/style', { style: { ...style, color: 'neon' } });
  check('invalid style is rejected', r.status === 400, r);

  // projects (seeded directly: the create path is the paid AI route)
  await db
    .collection('projects')
    .doc(PROJECT)
    .set({
      uid: OWNER,
      title: 'Busan',
      userPrompt: 'trip',
      userMemos: [],
      scenes: [],
      script: { title: 'Busan', scenes: [] },
      source: 'llm',
      model: null,
      stage: 'script_ready',
      percent: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  r = await call(owner, 'GET', '/projects');
  check(
    'list returns my project (index works)',
    r.status === 200 && !!r.body?.projects?.some((p) => p.id === PROJECT),
    r,
  );

  r = await call(owner, 'GET', `/projects/${PROJECT}`);
  check('get', r.status === 200 && r.body?.title === 'Busan', r);

  r = await call(owner, 'PATCH', `/projects/${PROJECT}`, { title: 'Seoul', style });
  check('patch', r.status === 204, r);
  const patched = (await db.collection('projects').doc(PROJECT).get()).data();
  check('patch stored, uid untouched', patched?.title === 'Seoul' && patched?.uid === OWNER);

  r = await call(owner, 'PATCH', `/projects/${PROJECT}`, {});
  check('empty patch is rejected', r.status === 400, r);

  r = await call(other, 'GET', `/projects/${PROJECT}`);
  check("other user's get is 404", r.status === 404, r);
  r = await call(other, 'DELETE', `/projects/${PROJECT}`);
  check(
    "other user's delete is 404 and the doc survives",
    r.status === 404 && (await db.collection('projects').doc(PROJECT).get()).exists,
    r,
  );
  r = await call(other, 'GET', '/projects');
  check("other user's list is empty", r.status === 200 && r.body?.projects?.length === 0, r);

  r = await call(owner, 'DELETE', `/projects/${PROJECT}`);
  check(
    'delete',
    r.status === 204 && !(await db.collection('projects').doc(PROJECT).get()).exists,
    r,
  );
}

main()
  .catch((err) => {
    failed++;
    console.error(err);
  })
  .finally(async () => {
    await cleanup();
    console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
    process.exit(failed === 0 ? 0 : 1);
  });
