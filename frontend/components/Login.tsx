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
    signOut,
    devSignIn,
  } = useAuth();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
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
          {error && (
            <p className="notice error" role="alert">
              {error}
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
              setBusy(true);
              try {
                await signInWithPassword(email, password);
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
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={!configured || loading || busy}>
              {busy ? 'Signing in…' : 'Sign in with email'}
            </button>
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
