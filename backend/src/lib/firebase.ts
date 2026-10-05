import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
}

/**
 * Parses the service account key from an env var. Accepts the raw JSON file contents or the same
 * JSON base64-encoded (easier to paste into a hosting dashboard without newline problems).
 */
export function parseServiceAccount(raw: string): ServiceAccountKey {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw.trim(), 'base64').toString('utf8');
  let json: { client_email?: unknown; private_key?: unknown };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is neither valid JSON nor base64-encoded JSON.');
  }
  if (typeof json.client_email !== 'string' || typeof json.private_key !== 'string') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain client_email and private_key.');
  }
  return { clientEmail: json.client_email, privateKey: json.private_key.replace(/\\n/g, '\n') };
}

let serviceAccount: ServiceAccountKey | undefined;

/** Call once at startup. Without a key the Admin SDK falls back to Application Default Credentials. */
export function configureFirebase(key?: ServiceAccountKey): void {
  serviceAccount = key;
}

/**
 * One Admin SDK app per process. On Google Cloud it signs in with the attached service account;
 * elsewhere (Render) it uses the key passed to configureFirebase(). Locally the Auth/Firestore
 * emulator env vars redirect it.
 */
export function getFirebaseApp(projectId: string): App {
  return (
    getApps()[0] ??
    initializeApp({
      projectId,
      ...(serviceAccount ? { credential: cert({ projectId, ...serviceAccount }) } : {}),
    })
  );
}
