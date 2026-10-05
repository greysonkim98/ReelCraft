import { describe, expect, it } from 'vitest';
import { parseServiceAccount } from '../src/lib/firebase';

// Hosting dashboards often store the key with the two characters "\n" instead of real newlines.
const key = {
  client_email: 'svc@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
};

describe('parseServiceAccount', () => {
  it('reads raw JSON and restores newlines in the private key', () => {
    const out = parseServiceAccount(JSON.stringify(key));
    expect(out.clientEmail).toBe(key.client_email);
    expect(out.privateKey).toContain('\n');
    expect(out.privateKey).not.toContain('\\n');
  });

  it('reads base64-encoded JSON', () => {
    const out = parseServiceAccount(Buffer.from(JSON.stringify(key)).toString('base64'));
    expect(out.clientEmail).toBe(key.client_email);
    expect(out.privateKey.split('\n')).toHaveLength(4);
  });

  it('rejects junk and incomplete keys with a message that names the variable', () => {
    expect(() => parseServiceAccount('not json at all')).toThrow(/FIREBASE_SERVICE_ACCOUNT_JSON/);
    expect(() => parseServiceAccount('{"client_email":"x"}')).toThrow(/private_key/);
  });
});
