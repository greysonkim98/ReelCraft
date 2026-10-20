import { describe, expect, it, vi } from 'vitest';
import { createNetworkVerifier } from '../src/services/networkVerification';

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }));
vi.mock('firebase-admin/app-check', () => ({ getAppCheck: () => ({ verifyToken }) }));
vi.mock('../src/lib/firebase', () => ({ getFirebaseApp: () => ({}) }));

describe('App Check network verification', () => {
  it('consumes the token and accepts only the configured web app', async () => {
    const verifier = createNetworkVerifier('project', 'app');
    verifyToken.mockResolvedValueOnce({ appId: 'app', alreadyConsumed: false });
    expect(await verifier.verify('token')).toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('token', { consume: true });
    verifyToken.mockResolvedValueOnce({ appId: 'another-app', alreadyConsumed: false });
    expect(await verifier.verify('token')).toBe(false);
  });

  it('rejects replayed tokens and verifier errors', async () => {
    const verifier = createNetworkVerifier('project', 'app');
    verifyToken.mockResolvedValueOnce({ appId: 'app', alreadyConsumed: true });
    expect(await verifier.verify('token')).toBe(false);
    verifyToken.mockRejectedValueOnce(new Error('invalid token'));
    expect(await verifier.verify('token')).toBe(false);
  });
});
