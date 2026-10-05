import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { AppError } from '../src/lib/errors';
import { createMemoryProjectStore } from '../src/services/projects';
import type { ScriptResult, ScriptService } from '../src/services/script';
import { createMemoryUsageStore } from '../src/services/usage';
import { fakeVerifier, makeRequest } from './helpers';

const okResult = (n: number, over: Partial<ScriptResult> = {}): ScriptResult => ({
  script: {
    title: 'Busan, Day One',
    scenes: Array.from({ length: n }, (_, i) => ({
      scene_id: `s${String(i + 1).padStart(2, '0')}`,
      caption: 'Slow golden light',
      voiceover: 'Slow golden light',
      location_text: null,
    })),
  },
  source: 'llm',
  model: 'openai/gpt-oss-20b',
  calls: 1,
  repairedScenes: [],
  ...over,
});

function setup(script: Partial<ScriptService> = {}, envOver: NodeJS.ProcessEnv = {}) {
  const env = loadEnv({ NODE_ENV: 'test', AI_PER_USER_PER_DAY: '2', GLOBAL_DAILY_AI_CAP: '3', ...envOver });
  const usage = createMemoryUsageStore();
  const projects = createMemoryProjectStore();
  const generateScript = vi.fn(async (input: { scenes: unknown[] }) => okResult(input.scenes.length));
  const notify = vi.fn();
  const app = createApp({
    env,
    script: { generateScript, ...script } as ScriptService,
    verifier: fakeVerifier,
    usage,
    projects,
    notifier: { notify },
  });
  return { app, usage, projects, generateScript, notify };
}

const auth = (uid = 'alice') => ({ Authorization: `Bearer good-${uid}` });
const post = (app: ReturnType<typeof setup>['app'], body: unknown, uid = 'alice') =>
  request(app).post('/api/v1/ai/script').set(auth(uid)).send(body as object);

describe('API', () => {
  it('GET /health needs no sign-in', async () => {
    const res = await request(setup().app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('there is no unauthenticated subtitle route any more', async () => {
    const res = await request(setup().app).post('/api/v1/dev/subtitles').send({});
    expect(res.status).toBe(404);
  });

  it('rejects a missing or invalid token', async () => {
    const { app } = setup();
    const none = await request(app).post('/api/v1/ai/script').send(makeRequest(2));
    expect(none.status).toBe(401);
    expect(none.body.code).toBe('UNAUTHENTICATED');
    const bad = await request(app).post('/api/v1/ai/script').set('Authorization', 'Bearer nope').send(makeRequest(2));
    expect(bad.status).toBe(401);
    expect((await request(app).get('/api/v1/me/usage')).status).toBe(401);
  });

  it('returns the script, project id and remaining uses', async () => {
    const { app, projects, notify } = setup();
    const res = await post(app, makeRequest(3));
    expect(res.status).toBe(200);
    expect(res.body.script.scenes).toHaveLength(3);
    expect(res.body.source).toBe('llm');
    expect(res.body.usage).toMatchObject({ used: 1, limit: 2, remaining: 1 });
    expect(projects.all.get(res.body.projectId)).toMatchObject({ uid: 'alice', stage: 'script_ready' });
    expect(notify).toHaveBeenCalledWith('alice', 'script:ready', { projectId: res.body.projectId });
  });

  it('validates scenes.json: field, duplicate ids and total length', async () => {
    const { app, generateScript } = setup();
    const noPrompt = await post(app, { ...makeRequest(2), userPrompt: '' });
    expect(noPrompt.status).toBe(400);
    expect(noPrompt.body.details.fields.userPrompt).toBeDefined();

    const dup = makeRequest(2);
    dup.scenes[1]!.scene_id = dup.scenes[0]!.scene_id;
    expect((await post(app, dup)).body.details.fields['scenes.1.scene_id']).toBe('duplicate scene_id');

    const long = makeRequest(10);
    long.scenes.forEach((s, i) => ((s.start = i * 9), (s.end = i * 9 + 8)));
    const res = await post(app, long);
    expect(res.status).toBe(400);
    expect(res.body.details.fields.scenes).toContain('max 65');

    const tooManyChars = makeRequest(1);
    tooManyChars.scenes[0]!.max_chars = 500;
    expect((await post(app, tooManyChars)).status).toBe(400);
    expect(generateScript).not.toHaveBeenCalled();
  });

  it('enforces the per-account daily limit and does not call the LLM past it', async () => {
    const { app, generateScript } = setup();
    expect((await post(app, makeRequest(2))).status).toBe(200);
    expect((await post(app, makeRequest(2))).status).toBe(200);
    const third = await post(app, makeRequest(2));
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('DAILY_LIMIT');
    expect(third.body.details.reason).toBe('user');
    expect(generateScript).toHaveBeenCalledTimes(2);
    // another account is unaffected
    expect((await post(app, makeRequest(2), 'bob')).status).toBe(200);
  });

  it('stops everyone once the service-wide daily cap is reached', async () => {
    const { app } = setup();
    await post(app, makeRequest(1), 'a');
    await post(app, makeRequest(1), 'b');
    await post(app, makeRequest(1), 'c');
    const res = await post(app, makeRequest(1), 'd');
    expect(res.status).toBe(429);
    expect(res.body.details.reason).toBe('global');
  });

  it('applies the per-IP cap only when enabled', async () => {
    const { app } = setup({}, { IP_DAILY_CAP: '1', IP_HASH_SALT: 'salt', AI_PER_USER_PER_DAY: '5', GLOBAL_DAILY_AI_CAP: '50' });
    expect((await post(app, makeRequest(1), 'a')).status).toBe(200);
    const res = await post(app, makeRequest(1), 'b');
    expect(res.status).toBe(429);
    expect(res.body.details.reason).toBe('ip');
  });

  it('gives the use back when the LLM was not reachable at all', async () => {
    const { app } = setup({ generateScript: vi.fn(async (i: { scenes: unknown[] }) => okResult(i.scenes.length, { source: 'fallback', model: null, calls: 0 })) });
    const first = await post(app, makeRequest(2));
    expect(first.body.source).toBe('fallback');
    expect(first.body.usage.used).toBe(0);
    for (let i = 0; i < 3; i++) expect((await post(app, makeRequest(2))).status).toBe(200); // more than the daily limit of 2
  });

  it('gives the use back when the service throws', async () => {
    const { app, usage } = setup({ generateScript: vi.fn().mockRejectedValue(new AppError(500, 'CONFIG_MISSING', 'GROQ_API_KEY is not set on the server.')) });
    const res = await post(app, makeRequest(2));
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('CONFIG_MISSING');
    expect((await usage.get('alice', new Date().toISOString().slice(0, 10), { perUser: 2, global: 3, perIp: 0 })).used).toBe(0);
  });

  it('keeps a spent use when the answer was a partly repaired LLM script', async () => {
    const { app } = setup({ generateScript: vi.fn(async (i: { scenes: unknown[] }) => okResult(i.scenes.length, { calls: 2, repairedScenes: ['s02'] })) });
    const res = await post(app, makeRequest(2));
    expect(res.body.usage.used).toBe(1);
  });

  it('GET /me/usage reports the account counter', async () => {
    const { app } = setup();
    await post(app, makeRequest(1));
    const res = await request(app).get('/api/v1/me/usage').set(auth());
    expect(res.body).toMatchObject({ used: 1, limit: 2, remaining: 1 });
    expect(new Date(res.body.resetAt).getUTCHours()).toBe(0);
  });

  it('logs each AI call for the monthly usage check', async () => {
    const { app, usage } = setup();
    await post(app, makeRequest(2));
    expect(usage.logs).toHaveLength(1);
    expect(usage.logs[0]).toMatchObject({ uid: 'alice', model: 'openai/gpt-oss-20b', calls: 1, scenes: 2 });
  });

  it('answers with the documented error shape for malformed JSON', async () => {
    const res = await request(setup().app)
      .post('/api/v1/ai/script')
      .set(auth())
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('env', () => {
  it('refuses memory stores and a missing project id in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'p', STORE: 'memory' })).toThrow(/STORE=memory/);
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/FIREBASE_PROJECT_ID/);
    expect(() => loadEnv({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'p', IP_DAILY_CAP: '3' })).toThrow(/IP_HASH_SALT/);
    expect(loadEnv({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'p' }).GROQ_MODEL).toBe('openai/gpt-oss-20b');
  });
});
