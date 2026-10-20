'use client';

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { ROLES, type Role } from '@reelcraft/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { startSession } from './api';
import { AUTH_EMULATOR, firebaseConfigured, getAuthClient } from './firebase';

interface AuthState {
  user: User | null;
  /** true until the saved session has been read */
  loading: boolean;
  /**
   * The account's role from the server. null while signed out OR while the server is still being
   * asked, so wait for `user && role` before routing by role. If the server cannot be reached this
   * falls back to 'user' (least privilege) and `sessionError` says why.
   */
  role: Role | null;
  sessionError: string | null;
  error: string | null;
  configured: boolean;
  signIn: () => Promise<void>;
  /** Emulator-only sign-in without Google. Undefined in production builds. */
  devSignIn?: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Fresh ID token for the API (refreshed automatically when close to expiry). */
  getToken: () => Promise<string>;
}

const AuthContext = createContext<AuthState | null>(null);

function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code === 'auth/unauthorized-domain') return 'This address is not an authorized sign-in domain for the project.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection and try again.';
  return (e as Error).message;
}

const isRole = (value: unknown): value is Role => (ROLES as readonly unknown[]).includes(value);

/**
 * Tells the server who just signed in so it can create or refresh users/{uid}, and returns the
 * account's role. Once per tab session per account: the role is kept in sessionStorage, so a role
 * changed in the console is picked up by the next tab session. Throws if the server cannot be
 * reached; the caller decides what to do (it must not be swallowed silently).
 */
async function recordSession(user: User): Promise<Role> {
  const key = `reelcraft:session:${user.uid}`;
  try {
    const saved = sessionStorage.getItem(key);
    if (isRole(saved)) return saved;
  } catch {
    // storage blocked: just ask the server
  }
  const { role } = await startSession(await user.getIdToken());
  const confirmed: Role = isRole(role) ? role : 'user';
  try {
    sessionStorage.setItem(key, confirmed);
  } catch {
    // best effort
  }
  return confirmed;
}

const DEV_EMAIL = 'dev@reelcraft.test';
const DEV_PASSWORD = 'reelcraft-dev-password';

export function AuthProvider({ mode, children }: { mode: 'signin' | 'session'; children: ReactNode }) {
  const configured = firebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);
  const [role, setRole] = useState<Role | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the latest sign-in may set the role (a sign-out or another account can overtake a slow request).
  const sessionSeq = useRef(0);

  useEffect(() => {
    if (!configured) return;
    const auth = getAuthClient(mode);
    if (mode === 'signin') {
      // Completes a redirect sign-in that just returned from Google.
      getRedirectResult(auth).catch((e: Error) => setError(e.message));
    }
    return onAuthStateChanged(auth, (u) => {
      const seq = ++sessionSeq.current;
      setUser(u);
      setLoading(false);
      setRole(null);
      setSessionError(null);
      if (!u) return;
      recordSession(u)
        .then((r) => {
          if (sessionSeq.current === seq) setRole(r);
        })
        .catch((e: unknown) => {
          // Not swallowed: this is why users/{uid} would silently never appear. Retried on the next load.
          console.warn('[auth] could not sync the profile with the server:', e);
          if (sessionSeq.current !== seq) return;
          setSessionError(e instanceof Error ? e.message : 'Could not reach the server.');
          setRole('user');
        });
    });
  }, [configured, mode]);

  const signIn = useCallback(async () => {
    setError(null);
    const auth = getAuthClient('signin');
    const provider = new GoogleAuthProvider();
    try {
      // A popup works on every host. The redirect flow silently loses the result when the app
      // (e.g. localhost) and authDomain are different sites, because browsers partition storage.
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try {
          await signInWithRedirect(auth, provider);
        } catch (e2) {
          setError(authErrorMessage(e2));
        }
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError(authErrorMessage(e));
      }
    }
  }, []);

  const devSignIn = useCallback(async () => {
    setError(null);
    const auth = getAuthClient(mode);
    try {
      await signInWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASSWORD);
    } catch {
      try {
        await createUserWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASSWORD);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [mode]);

  const signOut = useCallback(async () => {
    await fbSignOut(getAuthClient(mode));
  }, [mode]);

  const getToken = useCallback(async () => {
    const current = getAuthClient(mode).currentUser;
    if (!current) throw new Error('Not signed in.');
    return current.getIdToken();
  }, [mode]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      role,
      sessionError,
      error,
      configured,
      signIn,
      devSignIn: AUTH_EMULATOR ? devSignIn : undefined,
      signOut,
      getToken,
    }),
    [user, loading, role, sessionError, error, configured, signIn, devSignIn, signOut, getToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
