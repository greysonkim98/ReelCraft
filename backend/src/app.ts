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
import { createIpInfoService, type IpInfoService } from './services/ipinfo';
import { createMemoryNetworkStore, type NetworkStore } from './services/networks';
import type { NetworkVerifier } from './services/networkVerification';
import { createMemoryUserStore, type UserStore } from './services/users';
import { createAdminStore, createMemoryAdminStorage, type AdminStore } from './services/admin';

export interface AppDeps {
  env: Env;
  script: ScriptService;
  verifier: TokenVerifier;
  usage: UsageStore;
  projects: ProjectStore;
  users?: UserStore;
  notifier?: Notifier;
  logger?: Logger;
  ipinfo?: IpInfoService;
  networks?: NetworkStore;
  networkVerifier?: NetworkVerifier;
  admin?: AdminStore;
}

export function createApp({
  env,
  script,
  verifier,
  usage,
  projects,
  users,
  notifier,
  logger,
  ipinfo,
  networks,
  networkVerifier,
  admin,
}: AppDeps): Express {
  const log = logger ?? pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });
  const app = express();
  const networkStore = networks ?? createMemoryNetworkStore();
  const userStore = users ?? createMemoryUserStore();
  const adminStore =
    admin ??
    createAdminStore(
      createMemoryAdminStorage(
        'all' in userStore
          ? (userStore.all as Map<string, import('./services/users').UserRecord>)
          : undefined,
      ),
      {
        aiPerUserPerDay: env.AI_PER_USER_PER_DAY,
        globalDailyAiCap: env.GLOBAL_DAILY_AI_CAP,
        ipDailyCap: env.IP_DAILY_CAP,
        maxClips: 10,
        maxOutputSeconds: 60,
      },
    );

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
      users: userStore,
      admin: adminStore,
      notifier: notifier ?? noopNotifier,
      limits: {
        perUser: env.AI_PER_USER_PER_DAY,
        global: env.GLOBAL_DAILY_AI_CAP,
        perIp: env.IP_DAILY_CAP,
      },
      ipHashSalt: env.IP_HASH_SALT,
      ipinfo:
        ipinfo ??
        createIpInfoService({
          token: env.IPINFO_TOKEN,
          salt: env.IP_HASH_SALT,
          cache: networkStore.cache,
        }),
      networks: networkStore,
      flaggedAsns: env.IPINFO_FLAGGED_ASNS,
      networkVerifier,
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(log));
  return app;
}
