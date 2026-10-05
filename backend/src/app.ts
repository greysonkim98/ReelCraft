import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pino, { type Logger } from 'pino';
import pinoHttp from 'pino-http';
import type { Env } from './config/env';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { createApiRouter } from './routes';
import type { TokenVerifier } from './services/auth';
import type { ProjectStore } from './services/projects';
import { noopNotifier, type Notifier } from './services/realtime';
import type { ScriptService } from './services/script';
import type { UsageStore } from './services/usage';

export interface AppDeps {
  env: Env;
  script: ScriptService;
  verifier: TokenVerifier;
  usage: UsageStore;
  projects: ProjectStore;
  notifier?: Notifier;
  logger?: Logger;
}

export function createApp({ env, script, verifier, usage, projects, notifier, logger }: AppDeps): Express {
  const log = logger ?? pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '200kb' }));
  app.use(
    pinoHttp({
      logger: log,
      // Never log the raw client IP.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: 'Too many requests.', code: 'RATE_LIMITED' });
      },
    }),
  );

  app.use(
    '/api/v1',
    createApiRouter({
      script,
      verifier,
      usage,
      projects,
      notifier: notifier ?? noopNotifier,
      limits: { perUser: env.AI_PER_USER_PER_DAY, global: env.GLOBAL_DAILY_AI_CAP, perIp: env.IP_DAILY_CAP },
      ipHashSalt: env.IP_HASH_SALT,
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(log));
  return app;
}
