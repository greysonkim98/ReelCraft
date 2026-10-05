'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

export function Landing() {
  const { user, loading, error, configured, signIn, devSignIn } = useAuth();

  // A full page load, not router.replace: cross-origin isolation (COOP/COEP) is decided per document,
  // so the editor only gets multi-thread ffmpeg when it is loaded fresh from the server.
  useEffect(() => {
    if (user) window.location.replace('/editor');
  }, [user]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-3xl font-bold">ReelCraft</h1>
      <p className="text-slate-600">
        Turn your phone clips into a captioned, 60-second vertical reel. Your videos never leave your device: everything is
        analyzed, edited and encoded right in your browser.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li>Picks the best moments from your clips automatically</li>
        <li>AI writes short captions from your notes (only text is sent, never video)</li>
        <li>Exports 9:16 video, ready for Instagram Reels</li>
      </ul>

      {!configured && (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
          Sign-in is not configured for this build (missing NEXT_PUBLIC_FIREBASE_* settings).
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => void signIn()}
          disabled={!configured || loading}
          className="w-full rounded-xl bg-slate-900 px-5 py-3 text-center font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {loading ? 'Checking your sign-in…' : 'Continue with Google'}
        </button>
        {devSignIn && (
          <button
            type="button"
            onClick={() => void devSignIn()}
            data-testid="dev-sign-in"
            className="w-full rounded-xl border border-dashed border-slate-400 px-5 py-3 text-sm text-slate-600"
          >
            Developer sign-in (Auth emulator only)
          </button>
        )}
        <p className="text-xs text-slate-500">
          By continuing you agree to the <a href="/terms" className="underline">Terms</a> and the{' '}
          <a href="/privacy" className="underline">Privacy Policy</a>.
        </p>
      </div>

      <footer className="flex flex-wrap gap-4 text-xs text-slate-500">
        <a href="/terms" className="underline">Terms</a>
        <a href="/privacy" className="underline">Privacy</a>
        <a href="/licenses" className="underline">Open-source licenses</a>
      </footer>
    </main>
  );
}
