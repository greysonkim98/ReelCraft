'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { getAuthClient } from '@/lib/firebase';
import { verifyNetwork } from '@/lib/api';
import { Brand } from './ui/Brand';

let appCheck: import('firebase/app-check').AppCheck | undefined;

export function NetworkVerification() {
  const { user, loading, getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  // This variable belongs only in .env.development.local; production excludes this branch.
  const debugToken =
    process.env.NODE_ENV === 'development' &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
      ? process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN
      : undefined;
  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const { initializeAppCheck, ReCaptchaV3Provider, CustomProvider, getLimitedUseToken } =
        await import('firebase/app-check');
      if (debugToken) {
        (
          self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }
        ).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
      }
      appCheck ??= initializeAppCheck(getAuthClient('session').app, {
        provider: debugToken
          ? new CustomProvider({
              getToken: async () => {
                throw new Error('Local debug provider is inactive.');
              },
            })
          : new ReCaptchaV3Provider(siteKey!),
        isTokenAutoRefreshEnabled: false,
      });
      const attestation = await getLimitedUseToken(appCheck);
      await verifyNetwork(await getToken(), attestation.token);
      setDone(true);
    } catch {
      setError('Verification could not be completed. Please try again or contact support.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="legal-surface">
      <Brand />
      <h1>Verify your network</h1>
      {loading ? (
        <p role="status">Checking your sign-in...</p>
      ) : !user ? (
        <p>
          Sign in to your creator account in another tab, then reload this page.{' '}
          <a href="/login">Sign in</a>
        </p>
      ) : done ? (
        <p role="status">
          Verified for 10 minutes. Return to your editor tab and retry AI captions. You can close
          this tab.
        </p>
      ) : (
        <>
          <p>
            Complete this security check, then return to the editor. Keep your editor tab open so
            your clips stay available.
          </p>
          {!siteKey && !debugToken ? (
            <p role="alert">Network verification is not configured yet. Please contact support.</p>
          ) : (
            <button className="button primary" disabled={busy} onClick={() => void verify()}>
              {busy ? 'Verifying...' : 'Verify and continue'}
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
      {!debugToken && (
        <p className="fine-print">
          Protected by reCAPTCHA. Google&apos;s{' '}
          <a href="https://policies.google.com/privacy">Privacy Policy</a> and{' '}
          <a href="https://policies.google.com/terms">Terms of Service</a> apply.
        </p>
      )}
    </main>
  );
}
