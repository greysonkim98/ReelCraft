'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Brand } from './ui/Brand';
import { Icon } from './ui/Icon';
export function Login() {
  const {
    user,
    role,
    loading,
    error,
    sessionError,
    configured,
    signIn,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    devSignIn,
  } = useAuth();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [creating, setCreating] = useState(false),
    [formError, setFormError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  // Wait for the role: leaving the page earlier cancels the profile request that is still in flight.
  // Admins (set by hand in the console) go to the management console, everyone else to their projects.
  useEffect(() => {
    if (user && role && !sessionError)
      window.location.replace(role === 'admin' || role === 'support' ? '/admin' : '/projects');
  }, [user, role, sessionError]);
  return (
    <main className="login-page">
      <section className="login-form-side">
        <Brand />
        <div className="login-form">
          <span className="eyebrow">YOUR NEXT STORY STARTS HERE</span>
          <h1>
            Welcome to
            <br />
            your creative space.
          </h1>
          <p>Sign in to bring your clips together and make something worth sharing.</p>
          {!configured && (
            <div className="notice">
              Google sign-in is not configured yet. You can still explore the studio preview below.
            </div>
          )}
          {(formError ?? error) && (
            <p className="notice error" role="alert">
              {formError ?? error}
            </p>
          )}
          {sessionError && (
            <p className="notice" role="alert">
              {sessionError}{' '}
              <button className="text-link" onClick={() => void signOut()}>
                Sign out
              </button>
            </p>
          )}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setFormError(null);
              if (creating) {
                if (password.length < 8) return setFormError('Use at least 8 characters.');
                if (password !== confirm) return setFormError('The passwords do not match.');
              }
              setBusy(true);
              try {
                if (creating) await signUpWithPassword(email, password);
                else await signInWithPassword(email, password);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                autoComplete={creating ? 'new-password' : 'current-password'}
                required
                minLength={creating ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {creating && (
              <label className="field">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            )}
            <button className="button primary" disabled={!configured || loading || busy}>
              {creating
                ? busy
                  ? 'Creating account…'
                  : 'Create account'
                : busy
                  ? 'Signing in…'
                  : 'Sign in with email'}
            </button>
            <p className="login-terms">
              {creating ? 'Already have an account? ' : 'New to ReelCraft? '}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setCreating(!creating);
                  setFormError(null);
                }}
              >
                {creating ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          </form>
          <button
            onClick={() => void signIn()}
            disabled={!configured || loading}
            className="button google-button"
          >
            <span className="google-g" aria-hidden="true">
              G
            </span>
            {loading ? 'Checking your sign-in…' : 'Continue with Google'}
          </button>
          {devSignIn && (
            <button
              className="button secondary"
              onClick={() => void devSignIn()}
              disabled={!configured || loading}
              data-testid="dev-sign-in"
            >
              Developer sign-in (Auth emulator only)
            </button>
          )}
          <p className="login-terms">
            By continuing, you agree to our <Link href="/terms">Terms of Service</Link> and{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <div className="login-divider">
            <span /> JUST LOOKING AROUND? <span />
          </div>
          <Link href="/projects" className="button secondary">
            Explore the studio preview <Icon name="arrow" size={17} />
          </Link>
        </div>
        <span className="login-footnote">
          <Icon name="shield" size={15} /> Your videos stay yours. Your creativity is unlimited.
        </span>
      </section>
      <aside className="login-art">
        <img src="/images/alpine-lake.jpg" alt="Peaceful lake beneath the Italian Alps" />
        <div>
          <span className="eyebrow">LESS TIME ON THE TIMELINE.</span>
          <h2>
            More time
            <br />
            making memories.
          </h2>
          <p>Your camera roll has a story to tell.</p>
        </div>
        <span className="photo-credit">Photography via Unsplash</span>
      </aside>
    </main>
  );
}
