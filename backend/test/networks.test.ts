import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { hashIp } from '../src/lib/ip';
import { createIpInfoService } from '../src/services/ipinfo';
import { createMemoryNetworkStore } from '../src/services/networks';
import { createMemoryProjectStore } from '../src/services/projects';
import { createMemoryUsageStore, utcDay } from '../src/services/usage';
import { fakeVerifier, makeRequest } from './helpers';

const auth = (uid = 'alice') => ({ Authorization: `Bearer good-${uid}` });
function setup(extra: NodeJS.ProcessEnv = {}, outage = false) {
  const env = loadEnv({
    NODE_ENV: 'test',
    TRUST_PROXY_HOPS: '1',
    IPINFO_TOKEN: 'token',
    IP_HASH_SALT: 'salt',
    ...extra,
  });
  const networks = createMemoryNetworkStore();
  const usage = createMemoryUsageStore();
  const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (url) =>
    outage
      ? new Response('{}', { status: 503 })
      : new Response(
          JSON.stringify({
            ip: decodeURIComponent(String(url).split('/').at(-1)!),
            country: 'United States',
            country_code: 'US',
            asn: 'AS15169',
            as_name: 'Google LLC',
          }),
        ),
  );
  const ipinfo = createIpInfoService({
    token: env.IPINFO_TOKEN,
    salt: env.IP_HASH_SALT,
    cache: networks.cache,
    fetchFn,
  });
  const generateScript = vi.fn(async () => ({
    script: { title: 'Test', scenes: [] },
    source: 'llm' as const,
    model: 'test-model',
    calls: 1,
    repairedScenes: [],
  }));
  const verify = vi.fn(async (token: string) => token === 'one-use-token');
  const app = createApp({
    env,
    ipinfo,
    networks,
    usage,
    verifier: fakeVerifier,
    networkVerifier: { verify },
    script: { generateScript },
    projects: createMemoryProjectStore(),
  });
  const post = (uid = 'alice', ip = '8.8.8.8') =>
    request(app)
      .post('/api/v1/ai/script')
      .set(auth(uid))
      .set('X-Forwarded-For', ip)
      .send(makeRequest(1));
  const verifyIp = (uid = 'alice', ip = '8.8.8.8', token = 'one-use-token') =>
    request(app)
      .post('/api/v1/me/network-verification')
      .set(auth(uid))
      .set('X-Forwarded-For', ip)
      .set('X-Firebase-AppCheck', token)
      .send({});
  return { app, post, verifyIp, verify, networks, usage, generateScript, fetchFn };
}
afterEach(() => vi.restoreAllMocks());

describe('network integration', () => {
  it('records real country/ASN per AI request, distinct accounts, and enriched AI logs', async () => {
    const { post, networks, usage, fetchFn } = setup();
    await post();
    await post();
    await post('bob');
    const rows = await networks.list(utcDay(), 50);
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]).toMatchObject({
      country: 'United States',
      asn: 'AS15169',
      requests: 3,
      accountCount: 2,
      flagged: false,
    });
    expect(usage.logs[0]!.network?.ipHash).toBe(rows.items[0]!.ipHash);
    expect(JSON.stringify(rows)).not.toContain('8.8.8.8');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not spend provider requests or write stats before authentication and validation', async () => {
    const { app, fetchFn, networks } = setup();
    expect((await request(app).post('/api/v1/ai/script').send(makeRequest(1))).status).toBe(401);
    expect((await request(app).post('/api/v1/ai/script').set(auth()).send({})).status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(networks.activity.size).toBe(0);
  });

  it('requires verification before spending quota and scopes the grant to account and normalized IP', async () => {
    const { post, verifyIp, generateScript, usage, networks } = setup({
      IPINFO_FLAGGED_ASNS: 'AS15169',
      FIREBASE_WEB_APP_ID: 'web-app',
      IP_DAILY_CAP: '1',
    });
    const blocked = await post();
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('NETWORK_VERIFICATION_REQUIRED');
    expect(generateScript).not.toHaveBeenCalled();
    expect((await usage.get('alice', utcDay(), { perUser: 3, global: 60, perIp: 1 })).used).toBe(0);
    expect((await verifyIp('alice', '8.8.8.8', 'bad')).status).toBe(403);
    expect((await verifyIp()).status).toBe(200);
    expect((await post('alice', '::ffff:8.8.8.8')).status).toBe(200);
    expect((await post('bob')).body.code).toBe('NETWORK_VERIFICATION_REQUIRED');
    expect((await post('alice', '1.1.1.1')).body.code).toBe('NETWORK_VERIFICATION_REQUIRED');
    expect((await post()).body.details.reason).toBe('ip'); // verification cannot bypass caps
    expect((await networks.list(utcDay(), 50)).items.some((row) => row.flagged)).toBe(true);
  });

  it('requires another check after the 10-minute grant expires', async () => {
    const { post, verifyIp } = setup({
      IPINFO_FLAGGED_ASNS: 'AS15169',
      FIREBASE_WEB_APP_ID: 'web-app',
    });
    await verifyIp();
    expect((await post()).status).toBe(200);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000 + 1);
    expect((await post()).body.code).toBe('NETWORK_VERIFICATION_REQUIRED');
  });

  it('keeps per-IP and account limits during IPinfo failure', async () => {
    const { post, networks } = setup({ IP_DAILY_CAP: '1' }, true);
    expect((await post()).status).toBe(200);
    const denied = await post('bob');
    expect(denied.status).toBe(429);
    expect(denied.body.details.reason).toBe('ip');
    expect((await networks.list(utcDay(), 50)).items[0]).toMatchObject({
      lookupStatus: 'unavailable',
      country: null,
      requests: 2,
    });
  });

  it('does not trust a spoofed forwarded IP on a direct local server', async () => {
    const { post, fetchFn, networks } = setup({ TRUST_PROXY_HOPS: '0' });
    expect((await post()).status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await networks.list(utcDay(), 50)).items[0]!.lookupStatus).toBe('private');
  });

  it('fails closed before the LLM when recording security state fails', async () => {
    const { post, networks, generateScript } = setup();
    vi.spyOn(networks, 'record').mockRejectedValue(new Error('database offline'));
    expect((await post()).body.code).toBe('NETWORK_CHECK_UNAVAILABLE');
    expect(generateScript).not.toHaveBeenCalled();
  });

  it('protects verification with authentication and checks the attestation', async () => {
    const { app, verify, verifyIp } = setup();
    expect((await request(app).post('/api/v1/me/network-verification')).status).toBe(401);
    expect((await request(app).post('/api/v1/me/network-verification').set(auth())).status).toBe(
      403,
    );
    expect(verify).not.toHaveBeenCalled();
    expect((await verifyIp()).status).toBe(200);
    expect(verify).toHaveBeenCalledWith('one-use-token');
  });
});

describe('admin network activity', () => {
  it('denies anonymous and ordinary users regardless of client role claims', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/v1/admin/ips')).status).toBe(401);
    const res = await request(app)
      .get('/api/v1/admin/ips?role=admin')
      .set(auth())
      .set('X-Role', 'admin');
    expect(res.status).toBe(403);
  });

  it('allows support/admin roles, validates queries and paginates without exposing UIDs', async () => {
    const { app, post, networks } = setup();
    networks.roles.set('support', 'support');
    networks.roles.set('admin', 'admin');
    await post();
    await post('bob', '1.1.1.1');
    const first = await request(app).get('/api/v1/admin/ips?limit=1').set(auth('support'));
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(app)
      .get('/api/v1/admin/ips')
      .query({ limit: 1, cursor: first.body.nextCursor })
      .set(auth('admin'));
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].ipHash).not.toBe(first.body.items[0].ipHash);
    expect(second.body.nextCursor).toBeNull();
    expect(JSON.stringify(first.body)).not.toMatch(/alice|bob|8\.8\.8\.8|uids/);
    for (const query of [
      'day=2026-02-30',
      'limit=101',
      'limit=0',
      'cursor=invalid',
      `day=2026-01-01&cursor=${hashIp('8.8.8.8', 'salt')}_2026-01-02`,
    ]) {
      expect((await request(app).get(`/api/v1/admin/ips?${query}`).set(auth('admin'))).status).toBe(
        400,
      );
    }
  });
});

describe('network configuration', () => {
  it('requires a salt, validates ASNs and requires an App Check app ID for a watchlist', () => {
    expect(() => loadEnv({ IPINFO_TOKEN: 'token' })).toThrow(/IP_HASH_SALT/);
    expect(() => loadEnv({ IP_DAILY_CAP: '1' })).toThrow(/IP_HASH_SALT/);
    expect(() => loadEnv({ IPINFO_FLAGGED_ASNS: 'VPN' })).toThrow(/IPINFO_FLAGGED_ASNS/);
    expect(() => loadEnv({ IPINFO_FLAGGED_ASNS: 'AS1' })).toThrow(/FIREBASE_WEB_APP_ID/);
    expect(
      loadEnv({
        IPINFO_TOKEN: 'token',
        IP_HASH_SALT: 'salt',
        FIREBASE_WEB_APP_ID: 'app',
        IPINFO_FLAGGED_ASNS: ' as1, AS2, ',
      }).IPINFO_FLAGGED_ASNS,
    ).toEqual(['AS1', 'AS2']);
    expect(loadEnv({}).TRUST_PROXY_HOPS).toBe(0);
  });
});
