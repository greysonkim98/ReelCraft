'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Brand } from './ui/Brand';
import { Icon } from './ui/Icon';
export function Login() {
  const { user, loading, error, configured, signIn, devSignIn } = useAuth();
  useEffect(() => {
    if (user) window.location.replace('/projects');
  }, [user]);
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
