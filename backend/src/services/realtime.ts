import type { Server as HttpServer } from 'node:http';
import { progressEventSchema } from '@reelcraft/shared';
import { Server } from 'socket.io';
import type { Logger } from 'pino';
import type { ProjectStore } from './projects';
import { type AuthUser, type TokenVerifier } from './auth';

export interface Notifier {
  /** Push an event to every connected device of one user. */
  notify(uid: string, event: string, payload: unknown): void;
}

export const noopNotifier: Notifier = { notify() {} };

export interface RealtimeDeps {
  verifier: TokenVerifier;
  projects: ProjectStore;
  origins: string[];
  logger: Logger;
  /** Disconnect a socket that sent no progress event for this long. */
  idleMs?: number;
  /** Disconnect every socket after this long, active or not. */
  maxMs?: number;
  /** Refuse new connections beyond this many at once. */
  maxConnections?: number;
}

export const SOCKET_IDLE_MS = 120_000;
export const SOCKET_MAX_MS = 15 * 60_000;
export const SOCKET_MAX_CONNECTIONS = 50;

const room = (uid: string) => `u:${uid}`;
/** Events per socket per second. Anything above this is dropped. */
const MAX_EVENTS_PER_SECOND = 10;

/**
 * Socket.IO carries live progress. Firestore only stores state for recovery after a restart, and
 * a stage is written there only when it changes, so a 0-100% progress bar costs a handful of
 * writes instead of hundreds (the free quota is 20K writes a day).
 *
 * Cloud Run must run with max instances = 1 (rooms live in process memory) and clients must
 * reconnect after a cold start; socket.io-client does that on its own.
 *
 * COST GUARD: Cloud Run bills an instance for as long as any WebSocket is open, even when nothing
 * is sent. One forgotten tab would burn the free monthly CPU allowance in about two days, so every
 * socket is closed after a short idle time and after a hard maximum lifetime, and the number of
 * simultaneous sockets is capped. Clients connect only while a job runs and reconnect on demand.
 */
export function attachRealtime(httpServer: HttpServer, deps: RealtimeDeps): Notifier & { io: Server } {
  const io = new Server(httpServer, {
    cors: { origin: deps.origins, credentials: true },
    maxHttpBufferSize: 10_000,
  });

  const idleMs = deps.idleMs ?? SOCKET_IDLE_MS;
  const maxMs = deps.maxMs ?? SOCKET_MAX_MS;
  const maxConnections = deps.maxConnections ?? SOCKET_MAX_CONNECTIONS;

  io.use(async (socket, next) => {
    if (io.engine.clientsCount > maxConnections) return next(new Error('SERVER_BUSY'));
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || token === '') return next(new Error('UNAUTHENTICATED'));
    try {
      socket.data.user = await deps.verifier.verify(token);
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    void socket.join(room(user.uid));
    const lastStage = new Map<string, string>();
    let windowStart = Date.now();
    let eventsInWindow = 0;

    const close = (reason: 'idle' | 'max') => {
      socket.emit('session:expired', { reason });
      socket.disconnect(true);
    };
    let idleTimer = setTimeout(() => close('idle'), idleMs);
    const maxTimer = setTimeout(() => close('max'), maxMs);
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => close('idle'), idleMs);
    };
    socket.on('disconnect', () => {
      clearTimeout(idleTimer);
      clearTimeout(maxTimer);
    });

    socket.on('project:progress', async (payload: unknown, ack?: (res: { ok: boolean; code?: string }) => void) => {
      touch();
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        eventsInWindow = 0;
      }
      if (++eventsInWindow > MAX_EVENTS_PER_SECOND) return ack?.({ ok: false, code: 'RATE_LIMITED' });

      const parsed = progressEventSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, code: 'VALIDATION_ERROR' });
      const ev = parsed.data;
      try {
        const project = await deps.projects.get(ev.projectId);
        if (!project || project.uid !== user.uid) return ack?.({ ok: false, code: 'NOT_FOUND' });
        if (lastStage.get(ev.projectId) !== ev.stage) {
          lastStage.set(ev.projectId, ev.stage);
          await deps.projects.setStage(ev.projectId, ev.stage, ev.percent, ev.message);
        }
        socket.to(room(user.uid)).emit('project:progress', ev);
        ack?.({ ok: true });
      } catch (err) {
        deps.logger.error({ err }, 'progress event failed');
        ack?.({ ok: false, code: 'INTERNAL' });
      }
    });
  });

  return {
    io,
    notify(uid, event, payload) {
      io.to(room(uid)).emit(event, payload);
    },
  };
}
