import type { ProgressStage } from '@reelcraft/shared';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';

export interface ProgressReporter {
  report(stage: ProgressStage, percent: number, message?: string): void;
  close(): void;
}

export interface ReporterOptions {
  projectId: string;
  getToken: () => Promise<string>;
  /** Same stage updates closer together than this are dropped. */
  minIntervalMs?: number;
  now?: () => number;
  connect?: (token: string) => Socket;
}

const defaultConnect = (token: string): Socket =>
  // reconnection off: the server closes idle sockets on purpose (an open socket keeps the host
  // billed), so this reporter reconnects only when it has something to say.
  io(API_URL, { auth: { token }, transports: ['websocket'], reconnection: false });

/**
 * Best-effort progress for other devices of the same account. It never blocks or fails the job:
 * every error is swallowed. The socket is opened on the first report and closed on done/failed.
 */
export function createProgressReporter(opts: ReporterOptions): ProgressReporter {
  const minInterval = opts.minIntervalMs ?? 1000;
  const now = opts.now ?? Date.now;
  const connect = opts.connect ?? defaultConnect;

  let socket: Socket | null = null;
  let connecting: Promise<Socket | null> | null = null;
  let lastStage: ProgressStage | null = null;
  let lastSent = 0;

  const open = (): Promise<Socket | null> => {
    if (socket?.connected) return Promise.resolve(socket);
    connecting ??= opts
      .getToken()
      .then(
        (token) =>
          new Promise<Socket | null>((resolve) => {
            const s = connect(token);
            const drop = () => {
              if (socket === s) socket = null;
              connecting = null;
            };
            s.on('connect', () => {
              socket = s;
              resolve(s);
            });
            s.on('connect_error', () => {
              drop();
              resolve(null);
            });
            s.on('session:expired', drop);
            s.on('disconnect', drop);
          }),
      )
      .catch(() => null);
    return connecting;
  };

  const reporter: ProgressReporter = {
    report(stage, percent, message) {
      const terminal = stage === 'done' || stage === 'failed';
      const t = now();
      if (!terminal && stage === lastStage && t - lastSent < minInterval) return;
      lastStage = stage;
      lastSent = t;
      void open().then((s) => {
        s?.emit('project:progress', { projectId: opts.projectId, stage, percent: Math.round(percent), ...(message ? { message } : {}) });
        if (terminal) reporter.close();
      });
    },
    close() {
      socket?.disconnect();
      socket = null;
      connecting = null;
    },
  };
  return reporter;
}
