import { describe, expect, it } from 'vitest';
import { resolveAuthDomain } from './firebase';

describe('resolveAuthDomain', () => {
  const configured = 'reelcraft-4a7a7.firebaseapp.com';

  it("uses the app's own host when deployed, so sign-in stays same-site", () => {
    expect(resolveAuthDomain('reelcraft-4a7a7.web.app', configured)).toBe('reelcraft-4a7a7.web.app');
    expect(resolveAuthDomain('app.example.com', configured)).toBe('app.example.com');
  });

  it('keeps the configured domain on localhost', () => {
    expect(resolveAuthDomain('localhost', configured)).toBe(configured);
    expect(resolveAuthDomain('localhost:3000', configured)).toBe(configured);
    expect(resolveAuthDomain('127.0.0.1:3000', configured)).toBe(configured);
  });
});
