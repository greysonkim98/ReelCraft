'use client';

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AUTH_EMULATOR, firebaseConfigured, getAuthClient } from './firebase';

interface AuthState {
  user: User | null;
  /** true until the saved session has been read */
  loading: boolean;
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

const DEV_EMAIL = 'dev@reelcraft.test';
const DEV_PASSWORD = 'reelcraft-dev-password';

export function AuthProvider({ mode, children }: { mode: 'signin' | 'session'; children: ReactNode }) {
  const configured = firebaseConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    const auth = getAuthClient(mode);
    if (mode === 'signin') {
      // Completes a redirect sign-in that just returned from Google.
      getRedirectResult(auth).catch((e: Error) => setError(e.message));
    }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, [configured, mode]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      await signInWithRedirect(getAuthClient('signin'), new GoogleAuthProvider());
    } catch (e) {
      setError((e as Error).message);
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
    () => ({ user, loading, error, configured, signIn, devSignIn: AUTH_EMULATOR ? devSignIn : undefined, signOut, getToken }),
    [user, loading, error, configured, signIn, devSignIn, signOut, getToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
