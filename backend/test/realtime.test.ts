import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryProjectStore } from '../src/services/projects';
import { attachRealtime } from '../src/services/realtime';
import { fakeVerifier, makeRequest } from './helpers';

let server: Server;
let url: string;
let notifier: ReturnType<typeof attachRealtime>;
let limits: { idleMs?: number; maxMs?: number; maxConnections?: number } = {};
const projects = createMemoryProjectStore();
const sockets: Socket[] = [];

const open = (token?: string) => {
  const s = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return s;
};
const connected = (s: Socket) =>
  new Promise<void>((resolve, reject) => {
    s.on('connect', () => resolve());
    s.on('connect_error', (e) => reject(e));
  });
const once = <T>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve));
const emitAck = (s: Socket, event: string, payload: unknown) =>
  new Promise<{ ok: boolean; code?: string }>((resolve) => s.emit(event, payload, resolve));

async function seed(id: string, uid: string) {
  const req = makeRequest(1);
  await projects.create(id, {
    uid,
    userPrompt: req.userPrompt,
    userMemos: req.userMemos,
    scenes: req.scenes,
    script: { title: 't', scenes: [] },
    source: 'llm',
    model: null,
    stage: 'script_ready',
    percent: 100,
  });
}

beforeEach(async () => {
  server = createServer();
  notifier = attachRealtime(server, { verifier: fakeVerifier, projects, origins: ['http://localhost:3000'], logger: pino({ level: 'silent' }), ...limits });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
  projects.all.clear();
});

afterEach(async () => {
  limits = {};
  sockets.splice(0).forEach((s) => s.close());
  await notifier.io.close();
});

const restart = async (l: typeof limits) => {
  await notifier.io.close();
  limits = l;
  server = createServer();
  notifier = attachRealtime(server, { verifier: fakeVerifier, projects, origins: ['http://localhost:3000'], logger: pino({ level: 'silent' }), ...limits });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
};
const disconnected = (s: Socket) => new Promise<string>((resolve) => s.once('disconnect', resolve));

describe('realtime cost guard', () => {
  it('disconnects a socket that stays idle', async () => {
    await restart({ idleMs: 150, maxMs: 5000 });
    const s = open('good-alice');
    await connected(s);
    const expired = once<{ reason: string }>(s, 'session:expired');
    const gone = disconnected(s);
    expect(await expired).toEqual({ reason: 'idle' });
    await gone;
    expect(s.connected).toBe(false);
  });

  it('progress events keep a working socket alive, up to the hard maximum', async () => {
    await restart({ idleMs: 200, maxMs: 700 });
    await seed('p1', 'alice');
    const s = open('good-alice');
    await connected(s);
    const expired = once<{ reason: string }>(s, 'session:expired');
    const beat = setInterval(() => s.emit('project:progress', { projectId: 'p1', stage: 'rendering', percent: 1 }), 80);
    const started = Date.now();
    const { reason } = await expired;
    clearInterval(beat);
    expect(reason).toBe('max');
    expect(Date.now() - started).toBeGreaterThanOrEqual(500); // stayed up past the idle limit
  });

  it('refuses connections above the cap', async () => {
    await restart({ idleMs: 5000, maxMs: 5000, maxConnections: 2 });
    const a = open('good-a');
    const b = open('good-b');
    await Promise.all([connected(a), connected(b)]);
    const c = open('good-c'); // the third socket exceeds the cap of 2
    await expect(connected(c)).rejects.toThrow(/SERVER_BUSY/);
    a.close(); // a freed slot can be used again
    await new Promise((r) => setTimeout(r, 100));
    const d = open('good-d');
    await connected(d);
  });
});

describe('realtime', () => {
  it('rejects a connection without a valid token', async () => {
    await expect(connected(open())).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(connected(open('bad'))).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('shares progress between devices of the same account only', async () => {
    await seed('p1', 'alice');
    const phone = open('good-alice');
    const laptop = open('good-alice');
    const stranger = open('good-bob');
    await Promise.all([connected(phone), connected(laptop), connected(stranger)]);

    const seen: unknown[] = [];
    stranger.on('project:progress', (e) => seen.push(e));
    const onLaptop = once<{ stage: string; percent: number }>(laptop, 'project:progress');

    const ack = await emitAck(phone, 'project:progress', { projectId: 'p1', stage: 'rendering', percent: 42 });
    expect(ack.ok).toBe(true);
    expect(await onLaptop).toMatchObject({ stage: 'rendering', percent: 42 });
    expect(seen).toHaveLength(0);
  });

  it('writes to the store only when the stage changes', async () => {
    await seed('p1', 'alice');
    const s = open('good-alice');
    await connected(s);
    for (const percent of [10, 20, 30]) await emitAck(s, 'project:progress', { projectId: 'p1', stage: 'rendering', percent });
    // first event stored stage + percent, the next two only went to other devices
    expect(projects.all.get('p1')).toMatchObject({ stage: 'rendering', percent: 10 });
    await emitAck(s, 'project:progress', { projectId: 'p1', stage: 'done', percent: 100 });
    expect(projects.all.get('p1')).toMatchObject({ stage: 'done', percent: 100 });
  });

  it("refuses progress for someone else's project and for invalid payloads", async () => {
    await seed('p1', 'alice');
    const bob = open('good-bob');
    await connected(bob);
    expect(await emitAck(bob, 'project:progress', { projectId: 'p1', stage: 'rendering', percent: 1 })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await emitAck(bob, 'project:progress', { projectId: 'p1', stage: 'nope', percent: 1 })).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
    expect(projects.all.get('p1')!.stage).toBe('script_ready');
  });

  it('drops events above the per-second limit', async () => {
    await seed('p1', 'alice');
    const s = open('good-alice');
    await connected(s);
    const acks = await Promise.all(
      Array.from({ length: 15 }, (_, i) => emitAck(s, 'project:progress', { projectId: 'p1', stage: 'rendering', percent: i })),
    );
    expect(acks.filter((a) => a.code === 'RATE_LIMITED').length).toBeGreaterThanOrEqual(5);
  });

  it('notify() reaches every device of the account', async () => {
    const a = open('good-alice');
    const b = open('good-alice');
    await Promise.all([connected(a), connected(b)]);
    const got = Promise.all([once(a, 'script:ready'), once(b, 'script:ready')]);
    notifier.notify('alice', 'script:ready', { projectId: 'p1' });
    expect(await got).toEqual([{ projectId: 'p1' }, { projectId: 'p1' }]);
  });
});
