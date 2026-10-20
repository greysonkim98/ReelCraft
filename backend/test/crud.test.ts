import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createMemoryProjectStore } from '../src/services/projects';
import type { ScriptService } from '../src/services/script';
import { createMemoryUsageStore } from '../src/services/usage';
import { createMemoryUserStore } from '../src/services/users';
import { fakeVerifier } from './helpers';

const style = { color: 'warm', subtitle: 'pop', tempo: 'calm', quality: '720p' } as const;
const auth = (uid: string) => ({ Authorization: `Bearer good-${uid}` });

function setup(userSeed?: Parameters<typeof createMemoryUserStore>[0]) {
  const projects = createMemoryProjectStore();
  const app = createApp({
    env: loadEnv({ NODE_ENV: 'test' }),
    script: {} as ScriptService,
    verifier: fakeVerifier,
    usage: createMemoryUsageStore(),
    projects,
    users: createMemoryUserStore(userSeed),
  });
  return { app, projects };
}

const seed = (projects: ReturnType<typeof setup>['projects'], id: string, uid: string) =>
  projects.create(id, {
    uid,
    title: 'Busan',
    userPrompt: 'trip',
    userMemos: [],
    scenes: [],
    script: { title: 'Busan', scenes: [] },
    source: 'llm',
    model: null,
    stage: 'script_ready',
    percent: 100,
  });

describe('users', () => {
  it('creates the profile on session and keeps the saved style', async () => {
    const { app } = setup();
    const first = await request(app).post('/api/v1/me/session').set(auth('alice'));
    expect(first.body).toEqual({ email: 'alice@example.com', role: 'user' });
    expect((await request(app).put('/api/v1/me/style').set(auth('alice')).send({ style })).status).toBe(204);
    const again = await request(app).post('/api/v1/me/session').set(auth('alice'));
    expect(again.body.style).toEqual(style);
  });

  it('returns the stored role and never changes it', async () => {
    const { app } = setup({ boss: { role: 'admin' } });
    const first = await request(app).post('/api/v1/me/session').set(auth('boss'));
    expect(first.body.role).toBe('admin');
    expect((await request(app).post('/api/v1/me/session').set(auth('boss'))).body.role).toBe('admin');
    expect((await request(app).post('/api/v1/me/session').set(auth('someone'))).body.role).toBe('user');
  });

  it('treats an unknown role value as a plain user', async () => {
    const { app } = setup({ odd: { role: 'superuser' as never } });
    expect((await request(app).post('/api/v1/me/session').set(auth('odd'))).body.role).toBe('user');
  });

  it('rejects an unknown style value', async () => {
    const res = await request(setup().app)
      .put('/api/v1/me/style')
      .set(auth('alice'))
      .send({ style: { ...style, color: 'neon' } });
    expect(res.status).toBe(400);
  });

  it('needs sign-in', async () => {
    expect((await request(setup().app).post('/api/v1/me/session')).status).toBe(401);
  });
});

describe('projects', () => {
  it('lists only my projects', async () => {
    const { app, projects } = setup();
    await seed(projects, 'p1', 'alice');
    await seed(projects, 'p2', 'bob');
    const res = await request(app).get('/api/v1/projects').set(auth('alice'));
    expect(res.body.projects.map((p: { id: string }) => p.id)).toEqual(['p1']);
  });

  it('reads, updates and deletes my project', async () => {
    const { app, projects } = setup();
    await seed(projects, 'p1', 'alice');
    expect((await request(app).get('/api/v1/projects/p1').set(auth('alice'))).body.title).toBe('Busan');

    const patch = await request(app).patch('/api/v1/projects/p1').set(auth('alice')).send({ title: 'Seoul', style });
    expect(patch.status).toBe(204);
    const after = await request(app).get('/api/v1/projects/p1').set(auth('alice'));
    expect(after.body.title).toBe('Seoul');
    expect(after.body.style).toEqual(style);

    expect((await request(app).delete('/api/v1/projects/p1').set(auth('alice'))).status).toBe(204);
    expect((await request(app).get('/api/v1/projects/p1').set(auth('alice'))).status).toBe(404);
  });

  it("answers 404 for someone else's project and leaves it untouched", async () => {
    const { app, projects } = setup();
    await seed(projects, 'p1', 'alice');
    expect((await request(app).get('/api/v1/projects/p1').set(auth('bob'))).status).toBe(404);
    expect((await request(app).patch('/api/v1/projects/p1').set(auth('bob')).send({ title: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/v1/projects/p1').set(auth('bob'))).status).toBe(404);
    expect(await projects.get('p1')).not.toBeNull();
  });

  it('rejects an empty patch and fields the user may not edit', async () => {
    const { app, projects } = setup();
    await seed(projects, 'p1', 'alice');
    expect((await request(app).patch('/api/v1/projects/p1').set(auth('alice')).send({})).status).toBe(400);
    await request(app).patch('/api/v1/projects/p1').set(auth('alice')).send({ title: 'ok', uid: 'bob' });
    expect((await projects.get('p1'))?.uid).toBe('alice');
  });
});
