import { describe, expect, it } from 'vitest';
import { resolveAuthDomain } from './firebase';

describe('resolveAuthDomain', () => {
  const configured = 'reelcraft-4a7a7.firebaseapp.com';

  it('always uses the configured domain, which is the one Google has registered', () => {
    expect(resolveAuthDomain('reelcraft-4a7a7.web.app', configured)).toBe(configured);
    expect(resolveAuthDomain('app.example.com', configured)).toBe(configured);
    expect(resolveAuthDomain('localhost:3000', configured)).toBe(configured);
  });

  it('falls back to the host when nothing is configured', () => {
    expect(resolveAuthDomain('app.example.com', undefined)).toBe('app.example.com');
  });
});
