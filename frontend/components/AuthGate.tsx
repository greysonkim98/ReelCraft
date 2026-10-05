'use client';

import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

/** The editor needs a signed-in account (AI caption runs are counted per account). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, configured } = useAuth();

  // Full page load so the sign-in page is not stuck inside the editor's isolated document.
  useEffect(() => {
    if (configured && !loading && !user) window.location.replace('/');
  }, [configured, loading, user]);

  if (!configured) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12 text-sm text-rose-800">
        Sign-in is not configured for this build (missing NEXT_PUBLIC_FIREBASE_* settings).
      </main>
    );
  }
  if (loading || !user) {
    return <main className="mx-auto max-w-xl px-4 py-12 text-sm text-slate-600">Checking your sign-in…</main>;
  }
  return <>{children}</>;
}
