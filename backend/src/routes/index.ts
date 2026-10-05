import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { scriptRequestSchema, type GenerateScriptResponse, type ScriptRequest } from '@reelcraft/shared';
import { AppError } from '../lib/errors';
import { validateBody } from '../middleware/validate';
import { currentUser, requireAuth, type TokenVerifier } from '../services/auth';
import type { ProjectStore } from '../services/projects';
import type { Notifier } from '../services/realtime';
import type { ScriptService } from '../services/script';
import { utcDay, type UsageLimits, type UsageStore } from '../services/usage';

export interface RouterDeps {
  script: ScriptService;
  verifier: TokenVerifier;
  usage: UsageStore;
  projects: ProjectStore;
  notifier: Notifier;
  limits: UsageLimits;
  /** Salt for hashing client IPs; the raw IP is never stored. Needed only for the per-IP cap. */
  ipHashSalt?: string;
}

const DAILY_LIMIT_MESSAGES = {
  user: 'You have used all of your AI scripts for today. Your limit resets at 00:00 UTC.',
  global: 'The AI service has reached its daily capacity. Please try again after 00:00 UTC.',
  ip: 'Too many scripts were requested from this network today. Please try again tomorrow.',
} as const;

export function createApiRouter(deps: RouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.verifier);

  const ipHash = (req: Request): string | undefined =>
    deps.limits.perIp > 0 && deps.ipHashSalt && req.ip
      ? createHash('sha256').update(`${deps.ipHashSalt}|${req.ip}`).digest('hex').slice(0, 32)
      : undefined;

  router.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  router.get('/me/usage', auth, async (_req, res, next) => {
    try {
      res.json(await deps.usage.get(currentUser(res).uid, utcDay(), deps.limits));
    } catch (err) {
      next(err);
    }
  });

  // A burst guard on top of the daily cap: a script takes seconds, so a few per minute is plenty.
  const scriptBurst = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (_req, res) => (res as { locals: { user?: { uid: string } } }).locals.user?.uid ?? 'anon',
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests.', code: 'RATE_LIMITED' });
    },
  });

  router.post('/ai/script', auth, scriptBurst, validateBody(scriptRequestSchema), async (req, res, next) => {
    const { uid } = currentUser(res);
    const input = req.body as ScriptRequest;
    const day = utcDay();
    const hash = ipHash(req);
    let consumed = false;
    try {
      const spend = await deps.usage.consume(uid, day, deps.limits, hash);
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
      });

      const usage = await deps.usage.get(uid, day, deps.limits);
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
  });

  return router;
}
