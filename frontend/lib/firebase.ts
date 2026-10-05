import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';

// Public web config (safe to ship; access is controlled by Firestore rules and ID-token checks).
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** "host:port" of the Auth emulator for local development; empty in production builds. */
export const AUTH_EMULATOR = process.env.NEXT_PUBLIC_AUTH_EMULATOR ?? '';

export function firebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

/**
 * Browsers partition third-party storage, which breaks signInWithRedirect when the sign-in helper
 * lives on another domain than the app. On Firebase Hosting both *.web.app and *.firebaseapp.com
 * serve /__/auth/*, so the app's own host works as authDomain. Localhost keeps the configured one
 * (use the Auth emulator there).
 */
export function resolveAuthDomain(host: string, configured: string | undefined): string | undefined {
  const local = host === 'localhost' || host === '127.0.0.1' || host.startsWith('localhost:') || host.startsWith('127.0.0.1:');
  return local ? configured : host;
}

function getApp(): FirebaseApp {
  const existing = getApps()[0];
  if (existing) return existing;
  const authDomain = typeof window === 'undefined' ? config.authDomain : resolveAuthDomain(window.location.host, config.authDomain);
  return initializeApp({ ...config, authDomain });
}

let auth: Auth | null = null;

/**
 * "signin" pages (the landing page) can run the redirect flow. "session" pages (the editor) only
 * read the saved session: the editor is cross-origin isolated (COEP) for multi-threaded ffmpeg, and
 * the redirect helper iframe would be blocked there, so no resolver is loaded.
 * Both share the same IndexedDB persistence, so signing in on one is seen on the other.
 */
export function getAuthClient(mode: 'signin' | 'session'): Auth {
  if (auth) return auth;
  auth = initializeAuth(getApp(), {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    ...(mode === 'signin' ? { popupRedirectResolver: browserPopupRedirectResolver } : {}),
  });
  if (AUTH_EMULATOR) connectAuthEmulator(auth, `http://${AUTH_EMULATOR}`, { disableWarnings: true });
  return auth;
}
