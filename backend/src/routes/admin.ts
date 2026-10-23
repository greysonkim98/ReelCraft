import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { networkActionSchema, settingsUpdateSchema, userActionSchema } from '@reelcraft/shared';
import { AppError } from '../lib/errors';
import { currentUser } from '../services/auth';
import type { AdminStore } from '../services/admin';
import { utcDay, type UsageStore } from '../services/usage';

export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
  });
const id = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes('/') && value !== '.' && value !== '..');
const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: id.optional(),
});
export function createAdminRouter(
  store: AdminStore,
  usage: UsageStore,
  auth: RequestHandler,
  hasSalt: boolean,
) {
  const router = Router();
  router.use(auth);
  const operator: RequestHandler = async (_req, res, next) => {
    try {
      await store.authorize(currentUser(res).uid);
      res.set('Cache-Control', 'no-store');
      next();
    } catch (error) {
      next(error);
    }
  };
  router.use(operator);
  // Express 4 does not forward rejected async handlers; this wrapper does.
  const route =
    (handler: RequestHandler): RequestHandler =>
    (req, res, next) => {
      Promise.resolve(handler(req, res, next)).catch(next);
    };
  const parse = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> => {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    return result.data;
  };
  router.get(
    '/overview',
    route(async (_req, res) => {
      const actor = await store.getUser(currentUser(res).uid);
      res.json(await store.overview(actor?.role === 'admin'));
    }),
  );
  router.get(
    '/users',
    route(async (req, res) => {
      const query = parse(
        paging.extend({
          search: z.string().trim().max(200).default(''),
          status: z.enum(['active', 'suspended', 'deleted', '']).default(''),
        }),
        req.query,
      );
      const result = await store.listUsers(query.limit, query.cursor, query.search, query.status);
      const settings = await store.getSettings();
      const adminLimits = await store.getAdminLimits();
      const limitsFor = (role: string) => ({
        perUser: role === 'admin' ? adminLimits.aiPerUserPerDay : settings.limits.aiPerUserPerDay,
        global: settings.limits.globalDailyAiCap,
        perIp: settings.limits.ipDailyCap,
      });
      res.json({
        ...result,
        items: await Promise.all(
          result.items.map(async (user) => ({
            ...user,
            aiUsedToday: (await usage.get(user.uid, utcDay(), limitsFor(user.role))).used,
          })),
        ),
      });
    }),
  );
  router.post(
    '/users/:uid/actions',
    route(async (req, res) => {
      res.json(
        await store.changeUser(
          currentUser(res).uid,
          parse(id, req.params.uid),
          parse(userActionSchema, req.body),
        ),
      );
    }),
  );
  router.get(
    '/settings',
    route(async (_req, res) => {
      await store.authorize(currentUser(res).uid, true);
      res.json(await store.getSettings());
    }),
  );
  router.put(
    '/settings',
    route(async (req, res) => {
      const input = parse(settingsUpdateSchema, req.body);
      if (input.limits.ipDailyCap > 0 && !hasSalt)
        throw new AppError(
          400,
          'CONFIG_MISSING',
          'Configure IP_HASH_SALT on the backend before enabling an IP cap.',
        );
      res.json(
        await store.updateSettings(currentUser(res).uid, input.limits, input.version, input.reason),
      );
    }),
  );
  router.get(
    '/audit',
    route(async (req, res) => {
      await store.authorize(currentUser(res).uid, true);
      const query = parse(paging, req.query);
      res.json(await store.audit(query.limit, query.cursor));
    }),
  );
  router.get(
    '/ips/:hash',
    route(async (req, res) => {
      const hash = parse(z.string().regex(/^[a-f0-9]{32}$/), req.params.hash);
      const query = parse(paging.extend({ day: daySchema.default(utcDay()) }), req.query);
      res.json({
        restriction: await store.restriction(hash),
        accounts: await store.networkAccounts(hash, query.day, query.limit, query.cursor),
      });
    }),
  );
  router.put(
    '/ips/:hash/restriction',
    route(async (req, res) => {
      res.json(
        await store.restrictNetwork(
          currentUser(res).uid,
          parse(z.string().regex(/^[a-f0-9]{32}$/), req.params.hash),
          parse(networkActionSchema, req.body),
        ),
      );
    }),
  );
  return router;
}
