import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import {
  projectPatchSchema,
  scriptRequestSchema,
  stylePreferenceSchema,
  type GenerateScriptResponse,
  type ProjectPatch,
  type NetworkActivity,
  type ScriptRequest,
  type StylePreference,
} from '@reelcraft/shared';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { hashIp, normalizeIp } from '../lib/ip';
import { checkNetwork, type NetworkDeps } from '../middleware/network';
import type { NetworkVerifier } from '../services/networkVerification';
import { validateBody } from '../middleware/validate';
import { currentUser, requireAuth, type TokenVerifier } from '../services/auth';
import type { ProjectStore } from '../services/projects';
import type { Notifier } from '../services/realtime';
import type { ScriptService } from '../services/script';
import { utcDay, type UsageLimits, type UsageStore } from '../services/usage';
import type { UserStore } from '../services/users';
import type { AdminStore } from '../services/admin';
import { createAdminRouter } from './admin';

export interface RouterDeps extends NetworkDeps {
  script: ScriptService;
  verifier: TokenVerifier;
  usage: UsageStore;
  projects: ProjectStore;
  users: UserStore;
  notifier: Notifier;
  limits: UsageLimits;
  /** Shared salt for IPinfo activity, network verification, and the optional per-IP cap. */
  ipHashSalt?: string;
  networkVerifier?: NetworkVerifier;
  admin: AdminStore;
}

const DAILY_LIMIT_MESSAGES = {
  user: 'You have used all of your AI scripts for today. Your limit resets at 00:00 UTC.',
  global: 'The AI service has reached its daily capacity. Please try again after 00:00 UTC.',
  ip: 'Too many scripts were requested from this network today. Please try again tomorrow.',
} as const;

export function createApiRouter(deps: RouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.verifier, deps.users);
  const liveLimits = async () => {
    const { limits } = await deps.admin.getSettings();
    return {
      perUser: limits.aiPerUserPerDay,
      global: limits.globalDailyAiCap,
      perIp: limits.ipDailyCap,
    };
  };
  router.get('/config', auth, async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await deps.admin.getSettings());
    } catch (error) {
      next(error);
    }
  });

  const ipHash = (req: Request): string | undefined => {
    const ip = normalizeIp(req.ip);
    return deps.ipHashSalt && ip ? hashIp(ip, deps.ipHashSalt) : undefined;
  };

  router.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  router.get('/me/usage', auth, async (_req, res, next) => {
    try {
      res.json(await deps.usage.get(currentUser(res).uid, utcDay(), await liveLimits()));
    } catch (err) {
      next(err);
    }
  });

  // Called once right after sign-in: creates the profile on first login and returns the saved style.
  router.post('/me/session', auth, async (_req, res, next) => {
    try {
      const { uid, email } = currentUser(res);
      res.json(await deps.users.touch(uid, email));
    } catch (err) {
      next(err);
    }
  });

  router.put('/me/style', auth, validateBody(stylePreferenceSchema), async (req, res, next) => {
    try {
      await deps.users.setStyle(currentUser(res).uid, (req.body as StylePreference).style);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects', auth, async (_req, res, next) => {
    try {
      res.json({ projects: await deps.projects.listByUser(currentUser(res).uid) });
    } catch (err) {
      next(err);
    }
  });

  // Someone else's project answers 404, not 403, so ids cannot be probed.
  const ownProject = async (id: string, uid: string) => {
    const project = await deps.projects.get(id);
    if (!project || project.uid !== uid) throw new AppError(404, 'NOT_FOUND', 'Project not found.');
    return project;
  };

  router.get('/projects/:id', auth, async (req, res, next) => {
    try {
      res.json({ id: req.params.id, ...(await ownProject(req.params.id!, currentUser(res).uid)) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/projects/:id', auth, validateBody(projectPatchSchema), async (req, res, next) => {
    try {
      await ownProject(req.params.id!, currentUser(res).uid);
      await deps.projects.update(req.params.id!, req.body as ProjectPatch);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.delete('/projects/:id', auth, async (req, res, next) => {
    try {
      await ownProject(req.params.id!, currentUser(res).uid);
      await deps.projects.remove(req.params.id!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // A burst guard on top of the daily cap: a script takes seconds, so a few per minute is plenty.
  const accountBurst = () =>
    rateLimit({
      windowMs: 60_000,
      limit: 5,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (_req, res) =>
        (res as { locals: { user?: { uid: string } } }).locals.user?.uid ?? 'anon',
      handler: (_req, res) => {
        res.status(429).json({ error: 'Too many requests.', code: 'RATE_LIMITED' });
      },
    });
  const scriptBurst = accountBurst();

  router.get('/admin/ips', auth, async (req, res, next) => {
    try {
      await deps.admin.authorize(currentUser(res).uid);
      const query = z
        .object({
          day: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((day) => {
              const date = new Date(`${day}T00:00:00Z`);
              return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
            })
            .default(utcDay()),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z
            .string()
            .regex(/^[a-f0-9]{32}_\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .safeParse(req.query);
      if (
        !query.success ||
        (query.data.cursor && !query.data.cursor.endsWith(`_${query.data.day}`))
      ) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Use a valid UTC day, page limit (1-100), and cursor.',
        );
      }
      const { day, limit, cursor } = query.data;
      res.set('Cache-Control', 'no-store');
      const page = await deps.networks.list(day, limit, cursor);
      res.json({
        ...page,
        items: await Promise.all(
          page.items.map(async (item) => ({
            ...item,
            blockedUntil: (await deps.admin.restriction(item.ipHash))?.expiresAt ?? 0,
          })),
        ),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/me/network-verification', auth, accountBurst(), async (req, res, next) => {
    try {
      if (!deps.networkVerifier)
        throw new AppError(
          503,
          'VERIFICATION_UNAVAILABLE',
          'Network verification is not configured. Contact support.',
        );
      const hash = ipHash(req);
      const token = req.header('X-Firebase-AppCheck');
      if (!hash || !token || token.length > 8192 || !(await deps.networkVerifier.verify(token))) {
        throw new AppError(
          403,
          'VERIFICATION_FAILED',
          'Verification failed or expired. Please try again.',
        );
      }
      const expiresAt = Date.now() + 10 * 60 * 1000;
      await deps.networks.markVerified(currentUser(res).uid, hash, expiresAt);
      res.set('Cache-Control', 'no-store');
      res.json({ expiresAt: new Date(expiresAt).toISOString() });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/ai/script',
    auth,
    scriptBurst,
    validateBody(scriptRequestSchema),
    checkNetwork({ ...deps, restriction: (hash) => deps.admin.restriction(hash) }),
    async (req, res, next) => {
      const { uid } = currentUser(res);
      const input = req.body as ScriptRequest;
      const day = utcDay();
      let hash: string | undefined;
      let consumed = false;
      try {
        const { limits: runtime } = await deps.admin.getSettings();
        if (
          input.scenes.reduce((sum, scene) => sum + scene.end - scene.start, 0) >
          runtime.maxOutputSeconds + 0.001
        )
          throw new AppError(
            400,
            'RUNTIME_LIMIT',
            `Selected scenes exceed the current ${runtime.maxOutputSeconds}-second reel limit.`,
          );
        const limits = {
          perUser: runtime.aiPerUserPerDay,
          global: runtime.globalDailyAiCap,
          perIp: runtime.ipDailyCap,
        };
        hash = limits.perIp > 0 ? ipHash(req) : undefined;
        const spend = await deps.usage.consume(uid, day, limits, hash);
        if (!spend.ok) {
          throw new AppError(429, 'DAILY_LIMIT', DAILY_LIMIT_MESSAGES[spend.reason], {
            reason: spend.reason,
            usage: spend.usage,
          });
        }
        consumed = true;

        const result = await deps.script.generateScript(input);
        // No Groq answer at all means nothing was spent upstream: give the use back.
        if (result.calls === 0) {
          await deps.usage.refund(uid, day, hash);
          consumed = false;
        }

        const projectId = randomUUID();
        await deps.projects.create(projectId, {
          uid,
          title: result.script.title,
          userPrompt: input.userPrompt,
          userMemos: input.userMemos,
          scenes: input.scenes,
          script: result.script,
          source: result.source,
          model: result.model,
          stage: 'script_ready',
          percent: 100,
        });
        await deps.usage.logAi({
          uid,
          projectId,
          model: result.model,
          source: result.source,
          calls: result.calls,
          scenes: input.scenes.length,
          ...(res.locals.network
            ? { network: res.locals.network as Omit<NetworkActivity, 'requests' | 'accountCount'> }
            : {}),
        });

        const usage = await deps.usage.get(uid, day, limits);
        const body: GenerateScriptResponse = {
          projectId,
          script: result.script,
          source: result.source,
          model: result.model,
          usage,
        };
        deps.notifier.notify(uid, 'script:ready', { projectId });
        res.json(body);
      } catch (err) {
        if (consumed && !(err instanceof AppError && err.code === 'DAILY_LIMIT')) {
          await deps.usage.refund(uid, day, hash).catch(() => undefined);
        }
        next(err);
      }
    },
  );

  router.use('/admin', createAdminRouter(deps.admin, deps.usage, auth, !!deps.ipHashSalt));
  return router;
}
