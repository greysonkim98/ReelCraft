import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createAdminStore, createMemoryAdminStorage } from '../src/services/admin';
import { createMemoryUserStore } from '../src/services/users';
import { createMemoryUsageStore } from '../src/services/usage';
import { createMemoryProjectStore } from '../src/services/projects';
import { createMemoryNetworkStore } from '../src/services/networks';
import { fakeVerifier, makeRequest } from './helpers';
import { hashIp } from '../src/lib/ip';

function setup() {
  const users = createMemoryUserStore({
    root: { role: 'admin' },
    other: { role: 'admin' },
    support: { role: 'support' },
    alice: { role: 'user', email: 'alice@example.test' },
    bob: { role: 'user' },
  });
  const defaults = {
    aiPerUserPerDay: 3,
    globalDailyAiCap: 60,
    ipDailyCap: 0,
    maxClips: 10,
    maxOutputSeconds: 60,
  };
  const storage = createMemoryAdminStorage(users.all);
  const admin = createAdminStore(storage, defaults);
  const usage = createMemoryUsageStore();
  const networks = createMemoryNetworkStore();
  const generateScript = vi.fn(async () => ({
    script: { title: 'Test', scenes: [] },
    source: 'llm' as const,
    model: 'test',
    calls: 1,
    repairedScenes: [],
  }));
  const app = createApp({
    env: loadEnv({ NODE_ENV: 'test', IP_HASH_SALT: 'salt', TRUST_PROXY_HOPS: '1' }),
    users,
    admin,
    usage,
    networks,
    projects: createMemoryProjectStore(),
    verifier: fakeVerifier,
    script: { generateScript },
    ipinfo: {
      lookup: async (ip) => ({
        ipHash: hashIp(ip!, 'salt'),
        status: 'ok',
        info: { country: 'Test', countryCode: 'US', asn: 'AS123', asName: 'Test', asDomain: null },
      }),
    },
  });
  const auth = (uid = 'root') => ({ Authorization: `Bearer good-${uid}` });
  const action = (uid: string, body: object, actor = 'root') =>
    request(app)
      .post(`/api/v1/admin/users/${uid}/actions`)
      .set(auth(actor))
      .send({ reason: 'Testing management action', version: 0, ...body });
  const ai = (uid = 'alice') =>
    request(app)
      .post('/api/v1/ai/script')
      .set(auth(uid))
      .set('X-Forwarded-For', '8.8.8.8')
      .send(makeRequest(1));
  return { app, admin, users, usage, generateScript, auth, action, ai, defaults, storage };
}

describe('admin permissions and account management', () => {
  it('protects every management tab and reserves audit/settings for admins', async () => {
    const { app, auth } = setup();
    for (const path of ['overview', 'users', 'settings', 'audit', `ips/${'a'.repeat(32)}`]) {
      expect((await request(app).get(`/api/v1/admin/${path}`)).status).toBe(401);
      expect((await request(app).get(`/api/v1/admin/${path}`).set(auth('alice'))).status).toBe(403);
      expect((await request(app).get(`/api/v1/admin/${path}`).set(auth())).status).toBe(200);
    }
    expect((await request(app).get('/api/v1/admin/users').set(auth('support'))).status).toBe(200);
    for (const path of ['settings', 'audit'])
      expect((await request(app).get(`/api/v1/admin/${path}`).set(auth('support'))).status).toBe(
        403,
      );
    expect(
      (await request(app).get('/api/v1/admin/overview').set(auth('support'))).body.recentAudit,
    ).toEqual([]);
  });
  it('persists role changes with actor, reason, before/after and enforces the new role', async () => {
    const { app, action, auth, admin } = setup();
    expect((await action('alice', { action: 'role', role: 'support' })).body.role).toBe('support');
    expect((await request(app).get('/api/v1/admin/users').set(auth('alice'))).status).toBe(200);
    const log = (await admin.audit(10)).items;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorUid: 'root',
      action: 'user.role',
      target: 'users/alice',
      before: { role: 'user' },
      after: { role: 'support' },
    });
    expect(
      (await action('alice', { action: 'role', role: 'admin', version: 1 }, 'support')).status,
    ).toBe(403);
    expect((await admin.audit(10)).items).toHaveLength(1);
  });
  it('rejects self changes and stale versions without partial audit records', async () => {
    const { action, admin } = setup();
    expect((await action('root', { action: 'delete' })).status).toBe(400);
    const replies = await Promise.all([
      action('alice', { action: 'role', role: 'support' }),
      action('alice', { action: 'suspend', days: 1 }),
    ]);
    expect(replies.map((result) => result.status).sort()).toEqual([200, 409]);
    expect((await admin.audit(10)).items).toHaveLength(1);
  });
  it('prevents two admins concurrently removing each other', async () => {
    const { action, users } = setup();
    const replies = await Promise.all([
      action('other', { action: 'role', role: 'user' }, 'root'),
      action('root', { action: 'role', role: 'user' }, 'other'),
    ]);
    expect(replies.map((result) => result.status).sort()).toEqual([200, 403]);
    expect([...users.all.values()].filter((user) => user.role === 'admin')).toHaveLength(1);
  });
  it('bounds support suspensions and prevents overriding administrator restrictions', async () => {
    const { action, admin } = setup();
    expect((await action('alice', { action: 'suspend', days: 8 }, 'support')).status).toBe(403);
    expect((await action('root', { action: 'suspend', days: 1 }, 'support')).status).toBe(403);
    expect((await action('alice', { action: 'suspend', days: 7 }, 'support')).status).toBe(200);
    expect((await action('alice', { action: 'unsuspend', version: 1 }, 'support')).status).toBe(
      200,
    );
    await action('alice', { action: 'suspend', days: 30, version: 2 });
    expect((await action('alice', { action: 'unsuspend', version: 3 }, 'support')).status).toBe(
      403,
    );
    expect((await admin.getUser('alice'))?.status).toBe('suspended');
  });
  it('blocks existing sessions on all protected endpoints and restores with least privilege', async () => {
    const { action, app, auth, ai } = setup();
    await action('alice', { action: 'suspend', days: 1 });
    for (const path of ['/projects', '/me/usage', '/config'])
      expect((await request(app).get(`/api/v1${path}`).set(auth('alice'))).body.code).toBe(
        'ACCOUNT_SUSPENDED',
      );
    expect((await request(app).post('/api/v1/me/session').set(auth('alice'))).status).toBe(403);
    expect((await ai()).status).toBe(403);
    await action('alice', { action: 'delete', version: 1 });
    expect((await ai()).body.code).toBe('ACCOUNT_DELETED');
    const restored = await action('alice', { action: 'restore', version: 2 });
    expect(restored.body).toMatchObject({
      status: 'active',
      role: 'user',
      suspendedUntil: null,
      deletedAt: null,
    });
    expect((await ai()).status).toBe(200);
  });
  it('rejects malformed requests, invalid IDs, missing reasons and unknown fields', async () => {
    const { action, app, auth } = setup();
    for (const body of [
      { action: 'role', role: 'owner' },
      { action: 'suspend', days: -1 },
      { action: 'delete', reason: '' },
      { action: 'role', role: 'admin', deletedAt: 1 },
    ])
      expect((await action('alice', body)).status).toBe(400);
    expect((await action('missing', { action: 'delete' })).status).toBe(404);
    expect((await action('a%2Fb', { action: 'delete' })).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/users?limit=1000').set(auth())).status).toBe(400);
  });
  it('paginates and searches persisted accounts without duplicate results', async () => {
    const { app, auth } = setup();
    const first = await request(app).get('/api/v1/admin/users?limit=2').set(auth());
    const next = await request(app)
      .get(`/api/v1/admin/users?limit=2&cursor=${first.body.nextCursor}`)
      .set(auth());
    expect(new Set([...first.body.items, ...next.body.items].map((user) => user.uid)).size).toBe(4);
    const search = await request(app)
      .get('/api/v1/admin/users?search=alice%40example.test')
      .set(auth());
    expect(search.body.items.map((user: { uid: string }) => user.uid)).toEqual(['alice']);
  });
});
describe('runtime controls and network restrictions', () => {
  it('changes live daily caps without clearing counters and rejects conflicting saves', async () => {
    const { app, auth, ai, defaults, admin } = setup();
    expect((await ai()).status).toBe(200);
    const saved = await request(app)
      .put('/api/v1/admin/settings')
      .set(auth())
      .send({
        limits: { ...defaults, aiPerUserPerDay: 1 },
        reason: 'Reduce test capacity',
        version: 0,
      });
    expect(saved.status).toBe(200);
    expect((await ai()).body.code).toBe('DAILY_LIMIT');
    expect((await request(app).get('/api/v1/me/usage').set(auth('alice'))).body).toMatchObject({
      used: 1,
      limit: 1,
      remaining: 0,
    });
    expect(
      (
        await request(app)
          .put('/api/v1/admin/settings')
          .set(auth())
          .send({ limits: defaults, reason: 'Stale update test', version: 0 })
      ).status,
    ).toBe(409);
    expect((await admin.audit(10)).items).toHaveLength(1);
  });
  it('rejects overlong reels before calling the provider or consuming quota', async () => {
    const { app, auth, admin, defaults, generateScript } = setup();
    await admin.updateSettings('root', { ...defaults, maxOutputSeconds: 3 }, 0, 'Short reels test');
    expect(
      (await request(app).post('/api/v1/ai/script').set(auth('alice')).send(makeRequest(2))).body
        .code,
    ).toBe('RUNTIME_LIMIT');
    expect(generateScript).not.toHaveBeenCalled();
  });
  it('enforces temporary network blocks before spending quota and audits unblock', async () => {
    const { app, auth, ai, admin, generateScript } = setup();
    const hash = hashIp('8.8.8.8', 'salt');
    expect(
      (
        await request(app)
          .put(`/api/v1/admin/ips/${hash}/restriction`)
          .set(auth('support'))
          .send({ blocked: true, days: 1, reason: 'Test block', version: 0 })
      ).status,
    ).toBe(403);
    await admin.restrictNetwork('root', hash, {
      blocked: true,
      days: 1,
      reason: 'Test block',
      version: 0,
    });
    expect((await ai()).body.code).toBe('NETWORK_BLOCKED');
    expect(generateScript).not.toHaveBeenCalled();
    expect((await request(app).get('/api/v1/me/usage').set(auth('alice'))).body.used).toBe(0);
    await admin.restrictNetwork('root', hash, {
      blocked: false,
      days: 1,
      reason: 'Test unblock',
      version: 1,
    });
    expect((await ai()).status).toBe(200);
    expect((await admin.audit(10)).items.map((event) => event.action)).toEqual([
      'network.unblocked',
      'network.blocked',
    ]);
  });
  it('orders and paginates audit events and rejects mutation APIs', async () => {
    const { action, admin, app, auth } = setup();
    await action('alice', { action: 'role', role: 'support' });
    await action('bob', { action: 'delete' });
    const first = await admin.audit(1),
      next = await admin.audit(1, first.nextCursor!);
    expect(first.items[0]!.id).not.toBe(next.items[0]!.id);
    expect(next.nextCursor).toBeNull();
    expect(
      (await request(app).delete(`/api/v1/admin/audit/${first.items[0]!.id}`).set(auth())).status,
    ).toBe(404);
  });
});
