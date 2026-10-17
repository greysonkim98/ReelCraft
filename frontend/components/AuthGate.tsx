'use client';

import { useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { Icon } from './ui/Icon';

/** The editor needs a signed-in account (AI caption runs are counted per account). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, configured } = useAuth();
  const [preview, setPreview] = useState(false);
  if (loading)
    return (
      <div className="empty-state">
        <span className="loading-ring" />
        <h2>Opening your creative space…</h2>
        <p>Checking your sign-in.</p>
      </div>
    );
  if (!user && !preview)
    return (
      <div className="editor-welcome">
        <div>
          <span className="eyebrow">YOUR STORY STARTS HERE</span>
          <h1>
            A few clips.
            <br />
            Endless possibilities<span className="mint">.</span>
          </h1>
          <p>
            Sign in to create with AI captions, or explore the editor with your own clips. Your
            footage stays on your device.
          </p>
          <div className="hero-actions">
            <a href="/login" className="button primary">
              Sign in to create <Icon name="arrow" size={17} />
            </a>
            <button className="button secondary" onClick={() => setPreview(true)}>
              Preview the editor
            </button>
          </div>
          {!configured && (
            <p className="fine-print">
              Google sign-in is not configured for this build. Editor preview is available.
            </p>
          )}
        </div>
        <div className="welcome-poster">
          <img src="/images/ocean.jpg" alt="Ocean waves and open water" />
          <strong>Make waves.</strong>
        </div>
      </div>
    );
  return (
    <>
      {!user && (
        <div className="preview-note">
          <Icon name="film" size={16} />
          <p>
            <strong>Editor preview.</strong> Try local clip import, styles, and manual editing.{' '}
            <a href="/login">Sign in</a> to generate AI captions.
          </p>
        </div>
      )}
      {children}
    </>
  );
}
