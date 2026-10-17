'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { UsageInfo } from '@reelcraft/shared';
import { useAuth } from '@/lib/auth';
import { getUsage } from '@/lib/api';
import { Icon } from './ui/Icon';

export function AccountSettings() {
  const { user, signOut } = useAuth();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    try {
      setName(localStorage.getItem('reelcraft:preview-name') ?? user?.displayName ?? '');
    } catch {
      setName(user?.displayName ?? '');
    }
  }, [user]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h1>
            Account settings<span className="mint">.</span>
          </h1>
          <p>A little about you and your creative space.</p>
        </div>
      </div>
      <div className="settings-layout">
        <section className="panel">
          <div className="panel-heading">
            <h2>Your profile</h2>
            <span className="count-pill">UI preview</span>
          </div>
          <div className="profile-heading">
            <span className="avatar large-avatar">
              {(name || user?.displayName || 'C').slice(0, 1)}
            </span>
            <div>
              <h3>{user?.displayName ?? 'Your creator profile'}</h3>
              <p>{user?.email ?? 'Sign in to connect your Google account'}</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                localStorage.setItem('reelcraft:preview-name', name.trim());
                setMessage(
                  'Preview name saved in this browser. Your Google profile has not changed.',
                );
              } catch {
                setMessage(
                  'Browser storage is unavailable. Your profile preview could not be saved.',
                );
              }
            }}
          >
            <label className="field">
              Display name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
                placeholder="What should we call you?"
              />
            </label>
            <label className="field">
              Email address
              <input value={user?.email ?? ''} placeholder="Connect your Google account" disabled />
            </label>
            <p className="fine-print">
              Profile changes are a local preview until the account API is connected.
            </p>
            <button className="button primary" disabled={!name.trim()}>
              Save preview
            </button>
            {message && (
              <p role="status" className="notice">
                {message}
              </p>
            )}
          </form>
        </section>
        <div>
          <section className="panel">
            <span className="feature-icon">
              <Icon name="shield" />
            </span>
            <h2>Connected account</h2>
            <p>ReelCraft uses Google sign-in, so there’s one less password to remember.</p>
            {user ? (
              <button className="button secondary" onClick={() => void signOut()}>
                Sign out <Icon name="logout" size={16} />
              </button>
            ) : (
              <a href="/login" className="button secondary">
                Connect with Google <Icon name="arrow" size={16} />
              </a>
            )}
          </section>
          <section className="panel">
            <h2>Your data, your choice</h2>
            <p>
              Your original footage stays on your device. Account deletion controls will be
              available when account management is connected.
            </p>
            <Link className="text-link" href="/privacy">
              Read our privacy policy <Icon name="arrow" size={16} />
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}

export function UsagePage() {
  const { user, getToken, loading } = useAuth();
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setUsage(null);
    setError('');
    if (user)
      void getToken()
        .then(getUsage)
        .then((data) => {
          if (active) setUsage(data);
        })
        .catch((e: Error) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [user, getToken, retry]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ROOM TO CREATE</span>
          <h1>
            Your creative allowance<span className="mint">.</span>
          </h1>
          <p>A little AI help. As much hands-on creativity as you like.</p>
        </div>
        <span className="plan-badge">Free creator</span>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}{' '}
          <button className="text-link" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      <div className="usage-grid">
        <section className="panel usage-main">
          <span className="feature-icon">
            <Icon name="sparkles" />
          </span>
          <h2>AI caption generations</h2>
          <div className="usage-number">
            {usage ? usage.remaining : '—'}
            <span>{usage ? ` / ${usage.limit} remaining` : ' available after sign-in'}</span>
          </div>
          <div className="usage-meter">
            <span
              style={{
                width: usage
                  ? `${Math.max(0, Math.min(100, (usage.remaining / Math.max(1, usage.limit)) * 100))}%`
                  : '0%',
              }}
            />
          </div>
          <p>
            {usage
              ? `Resets ${new Date(usage.resetAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`
              : loading
                ? 'Checking your account…'
                : user
                  ? error
                    ? 'Your allowance is temporarily unavailable.'
                    : 'Loading your allowance…'
                  : 'Sign in to see your current daily allowance.'}
          </p>
          {!user && !loading && (
            <a href="/login" className="button primary">
              Sign in to view usage <Icon name="arrow" size={16} />
            </a>
          )}
        </section>
        <section className="panel">
          <span className="feature-icon">
            <Icon name="edit" />
          </span>
          <h2>Manual edits & renders</h2>
          <div className="usage-number">
            ∞<span> always unlimited</span>
          </div>
          <p>
            Adjust your cuts, rewrite captions, and render again. Manual editing never uses an AI
            generation.
          </p>
          <a href="/editor" className="text-link">
            Back to creating <Icon name="arrow" size={17} />
          </a>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>A note on narration</h2>
          <span className="count-pill">Coming later</span>
        </div>
        <p>
          Voice selection and narration allowances are part of the project plan. Narration is not
          enabled in this version; your original clip audio remains available.
        </p>
      </section>
      <section className="panel">
        <h2>Keep the inspiration going</h2>
        <div className="tips-grid">
          <div>
            <span>01</span>
            <h3>Give your clips context</h3>
            <p>A short note about the place or moment helps AI write more personal captions.</p>
          </div>
          <div>
            <span>02</span>
            <h3>Make a first draft count</h3>
            <p>Choose your scenes and describe the feeling you’re after before generating.</p>
          </div>
          <div>
            <span>03</span>
            <h3>Keep your creative control</h3>
            <p>Edit every caption yourself, even when your daily AI allowance runs out.</p>
          </div>
        </div>
      </section>
    </>
  );
}
