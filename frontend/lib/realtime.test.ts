import { EventEmitter } from 'node:events';
import type { Socket } from 'socket.io-client';
import { describe, expect, it, vi } from 'vitest';
import { createProgressReporter } from './realtime';

class FakeSocket extends EventEmitter {
  connected = false;
  emitted: { event: string; payload: unknown }[] = [];
  disconnected = false;
  override emit(event: string, payload?: unknown): boolean {
    if (event === 'project:progress') {
      this.emitted.push({ event, payload });
      return true;
    }
    return super.emit(event, payload);
  }
  disconnect() {
    this.connected = false;
    this.disconnected = true;
    super.emit('disconnect');
  }
  open() {
    this.connected = true;
    super.emit('connect');
  }
}

function setup(clock = { t: 0 }) {
  const sockets: FakeSocket[] = [];
  const getToken = vi.fn(async () => 'token');
  const connect = vi.fn((_t: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    queueMicrotask(() => s.open());
    return s as unknown as Socket;
  });
  const reporter = createProgressReporter({ projectId: 'p1', getToken, connect, now: () => clock.t, minIntervalMs: 1000 });
  return { reporter, sockets, getToken, connect, clock };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('progress reporter', () => {
  it('opens the socket lazily, on the first report', async () => {
    const { reporter, connect, sockets } = setup();
    expect(connect).not.toHaveBeenCalled();
    reporter.report('rendering', 10);
    await flush();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sockets[0]!.emitted[0]).toEqual({ event: 'project:progress', payload: { projectId: 'p1', stage: 'rendering', percent: 10 } });
  });

  it('drops same-stage updates that come too quickly, but not stage changes', async () => {
    const { reporter, sockets, clock } = setup();
    reporter.report('rendering', 10);
    clock.t = 200;
    reporter.report('rendering', 11); // dropped
    reporter.report('tts', 12); // stage change goes through
    clock.t = 1500;
    reporter.report('tts', 50);
    await flush();
    expect(sockets[0]!.emitted.map((e) => (e.payload as { percent: number }).percent)).toEqual([10, 12, 50]);
  });

  it('closes the socket after done or failed', async () => {
    const { reporter, sockets } = setup();
    reporter.report('rendering', 90);
    reporter.report('done', 100);
    await flush();
    expect(sockets[0]!.emitted).toHaveLength(2);
    expect(sockets[0]!.disconnected).toBe(true);
  });

  it('reconnects on the next report after the server closed an idle socket', async () => {
    const { reporter, sockets, connect, clock } = setup();
    reporter.report('rendering', 10);
    await flush();
    sockets[0]!.emit('session:expired');
    sockets[0]!.disconnect();
    clock.t = 5000;
    reporter.report('rendering', 60);
    await flush();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(sockets[1]!.emitted).toHaveLength(1);
  });

  it('never throws when the token or the connection fails', async () => {
    const failing = createProgressReporter({
      projectId: 'p1',
      getToken: async () => {
        throw new Error('signed out');
      },
      connect: () => {
        throw new Error('unreachable');
      },
    });
    expect(() => failing.report('rendering', 1)).not.toThrow();
    await flush();

    const refused = new FakeSocket();
    const rejected = createProgressReporter({
      projectId: 'p1',
      getToken: async () => 't',
      connect: () => {
        queueMicrotask(() => refused.emit('connect_error', new Error('SERVER_BUSY')));
        return refused as unknown as Socket;
      },
    });
    expect(() => rejected.report('rendering', 1)).not.toThrow();
    await flush();
    expect(refused.emitted).toHaveLength(0);
  });
});
