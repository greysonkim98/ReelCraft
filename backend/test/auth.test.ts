import { describe, expect, it, vi } from 'vitest';
const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken }) }));
vi.mock('../src/lib/firebase', () => ({ getFirebaseApp: () => ({}) }));
import { createFirebaseVerifier } from '../src/services/auth';

describe('Firebase token verification', () => {
  it('checks revocation and disabled accounts through the provider', async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: 'alice', email: 'alice@example.test' });
    await expect(createFirebaseVerifier('test').verify('fixture-token')).resolves.toEqual({ uid: 'alice', email: 'alice@example.test' });
    expect(verifyIdToken).toHaveBeenCalledWith('fixture-token', true);
  });
  it('propagates revoked token rejection', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('auth/id-token-revoked'));
    await expect(createFirebaseVerifier('test').verify('revoked-fixture')).rejects.toThrow('auth/id-token-revoked');
  });
});
