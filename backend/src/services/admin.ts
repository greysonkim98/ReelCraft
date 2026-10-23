import { randomUUID } from 'node:crypto';
import { FieldPath, getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  DEFAULT_LIMITS,
  type AdminPage,
  type AdminUser,
  type AuditEntry,
  type NetworkAction,
  type NetworkRestriction,
  type RuntimeLimits,
  type RuntimeSettings,
  type UserAction,
} from '@reelcraft/shared';
import { AppError } from '../lib/errors';
import { getFirebaseApp } from '../lib/firebase';
import { parseRole, type UserRecord } from './users';

type Data = Record<string, unknown>;
interface Change {
  path: string;
  data: Data;
}
export interface AdminStorage {
  get(path: string): Promise<Data | null>;
  page(
    collection: string,
    limit: number,
    cursor?: string,
    descending?: boolean,
  ): Promise<AdminPage<Data & { id: string }>>;
  transaction<T>(
    paths: string[],
    fn: (values: (Data | null)[]) => { writes: Change[]; result: T },
  ): Promise<T>;
  counts(): Promise<{ totalAccounts: number; suspendedAccounts: number; deletedAccounts: number }>;
}
export const millis = (value: unknown): number | null => {
  if (typeof value === 'number') return value;
  if (value && typeof (value as Timestamp).toMillis === 'function')
    return (value as Timestamp).toMillis();
  return null;
};
export const isRestricted = (data: Data | UserRecord | null) =>
  !!data && (!!millis(data.deletedAt) || (millis(data.suspendedUntil) ?? 0) > Date.now());
export function adminUser(uid: string, data: Data): AdminUser {
  const deletedAt = millis(data.deletedAt),
    suspendedUntil = millis(data.suspendedUntil);
  return {
    uid,
    email: typeof data.email === 'string' ? data.email : null,
    name: typeof data.displayName === 'string' ? data.displayName : null,
    role: parseRole(data.role),
    status: deletedAt ? 'deleted' : (suspendedUntil ?? 0) > Date.now() ? 'suspended' : 'active',
    deletedAt,
    suspendedUntil,
    reason: typeof data.reason === 'string' ? data.reason : null,
    createdAt: millis(data.createdAt),
    lastLoginAt: millis(data.lastLoginAt),
    version: Number(data.version ?? 0),
  };
}
export function assertOperator(data: Data | null, adminOnly = false): asserts data is Data {
  if (
    !data ||
    isRestricted(data) ||
    !(adminOnly ? ['admin'] : ['admin', 'support']).includes(String(data.role))
  )
    throw new AppError(
      403,
      'FORBIDDEN',
      adminOnly
        ? 'An active admin account is required.'
        : 'An active support or admin account is required.',
    );
}
const conflict = () =>
  new AppError(409, 'CONFLICT', 'This record changed. Refresh it before saving again.');

export function createAdminStore(storage: AdminStorage, defaults: RuntimeLimits) {
  const settings = (data: Data | null): RuntimeSettings => ({
    limits: { ...defaults, ...(data?.limits as Partial<RuntimeLimits> | undefined) },
    version: Number(data?.version ?? 0),
    updatedAt: millis(data?.updatedAt),
  });
  const audited = async <T>(
    actorUid: string,
    target: string,
    action: string,
    reason: string,
    adminOnly: boolean,
    change: (
      before: Data | null,
      actor: Data,
    ) => { data: Data; result: T; beforeAudit: Data | null; afterAudit: Data },
  ) => {
    const id = `${Date.now().toString().padStart(13, '0')}_${randomUUID()}`;
    return storage.transaction([`users/${actorUid}`, target], ([actorValue, before]) => {
      const actor = actorValue ?? null;
      assertOperator(actor, adminOnly);
      const result = change(before ?? null, actor);
      const event: AuditEntry = {
        id,
        actorUid,
        actorEmail: typeof actor.email === 'string' ? actor.email : null,
        actorRole: String(actor.role),
        action,
        target,
        reason,
        createdAt: Date.now(),
        before: result.beforeAudit,
        after: result.afterAudit,
      };
      return {
        writes: [
          { path: target, data: result.data },
          { path: `adminAudit/${id}`, data: { ...event } },
        ],
        result: result.result,
      };
    });
  };
  return {
    storage,
    async authorize(uid: string, adminOnly = false) {
      assertOperator(await storage.get(`users/${uid}`), adminOnly);
    },
    /** runtimeConfig/adminLimits: `{ aiPerUserPerDay: number }`, edited in the Firebase console. */
    async getAdminLimits(): Promise<{ aiPerUserPerDay: number }> {
      const value = (await storage.get('runtimeConfig/adminLimits'))?.aiPerUserPerDay;
      return {
        aiPerUserPerDay:
          typeof value === 'number' && Number.isInteger(value) && value >= 0
            ? value
            : DEFAULT_LIMITS.adminAiPerUserPerDay,
      };
    },
    async getSettings() {
      return settings(await storage.get('runtimeConfig/limits'));
    },
    async updateSettings(uid: string, limits: RuntimeLimits, version: number, reason: string) {
      return audited(uid, 'runtimeConfig/limits', 'limits.updated', reason, true, (before) => {
        if (settings(before).version !== version) throw conflict();
        const data = { limits, version: version + 1, updatedAt: Date.now() };
        return {
          data,
          result: settings(data),
          beforeAudit: { ...settings(before) },
          afterAudit: data,
        };
      });
    },
    async listUsers(
      limit: number,
      cursor?: string,
      search = '',
      status = '',
    ): Promise<AdminPage<AdminUser>> {
      const items: AdminUser[] = [];
      let nextCursor: string | null = cursor ?? null;
      // Bound work per request, preserving a cursor even when a filtered page is empty.
      for (let scanned = 0; scanned < 500 && items.length < limit;) {
        const page = await storage.page(
          'users',
          Math.min(100, limit - items.length),
          nextCursor ?? undefined,
        );
        scanned += page.items.length;
        for (const row of page.items) {
          const user = adminUser(row.id, row);
          if (
            (!status || user.status === status) &&
            `${user.uid} ${user.email ?? ''} ${user.name ?? ''}`
              .toLowerCase()
              .includes(search.toLowerCase())
          )
            items.push(user);
        }
        nextCursor = page.nextCursor;
        if (!nextCursor) break;
      }
      return { items, nextCursor };
    },
    async getUser(uid: string) {
      const data = await storage.get(`users/${uid}`);
      return data ? adminUser(uid, data) : null;
    },
    async changeUser(actorUid: string, uid: string, input: UserAction): Promise<AdminUser> {
      if (actorUid === uid)
        throw new AppError(400, 'SELF_CHANGE', 'Ask another admin to manage your account.');
      return audited(
        actorUid,
        `users/${uid}`,
        `user.${input.action}`,
        input.reason,
        !['suspend', 'unsuspend'].includes(input.action),
        (before, actor) => {
          if (!before) throw new AppError(404, 'NOT_FOUND', 'Account not found.');
          const current = adminUser(uid, before);
          if (current.version !== input.version) throw conflict();
          if (
            actor.role === 'support' &&
            (current.role !== 'user' ||
              (input.action === 'suspend' && input.days > 7) ||
              (current.status === 'suspended' && before.suspendedByRole !== 'support'))
          )
            throw new AppError(
              403,
              'FORBIDDEN',
              'Support can manage only support-issued suspensions of regular users, up to seven days.',
            );
          if (current.status === 'deleted' && input.action !== 'restore')
            throw new AppError(409, 'ACCOUNT_DELETED', 'Restore the account before changing it.');
          if (current.status !== 'deleted' && input.action === 'restore')
            throw new AppError(409, 'NOT_DELETED', 'Only deactivated accounts can be restored.');
          const patch: Data = {
            reason: input.reason,
            version: input.version + 1,
            updatedAt: Date.now(),
          };
          if (input.action === 'role') patch.role = input.role;
          if (input.action === 'suspend') {
            patch.suspendedUntil = Date.now() + input.days * 86400000;
            patch.suspendedByRole = actor.role;
          }
          if (input.action === 'unsuspend') {
            patch.suspendedUntil = null;
            patch.suspendedByRole = null;
          }
          if (input.action === 'delete') {
            patch.deletedAt = Date.now();
            patch.suspendedUntil = null;
          }
          if (input.action === 'restore') {
            patch.deletedAt = null;
            patch.suspendedUntil = null;
            patch.role = 'user';
          }
          const data = { ...before, ...patch },
            result = adminUser(uid, data);
          return { data, result, beforeAudit: { ...current }, afterAudit: { ...result } };
        },
      );
    },
    async audit(limit: number, cursor?: string): Promise<AdminPage<AuditEntry>> {
      return (await storage.page(
        'adminAudit',
        limit,
        cursor,
        true,
      )) as unknown as AdminPage<AuditEntry>;
    },
    async restriction(hash: string): Promise<NetworkRestriction | null> {
      return (await storage.get(
        `networkRestrictions/${hash}`,
      )) as unknown as NetworkRestriction | null;
    },
    async restrictNetwork(uid: string, hash: string, input: NetworkAction) {
      return audited(
        uid,
        `networkRestrictions/${hash}`,
        input.blocked ? 'network.blocked' : 'network.unblocked',
        input.reason,
        true,
        (before) => {
          if (Number(before?.version ?? 0) !== input.version) throw conflict();
          const data = {
            expiresAt: input.blocked ? Date.now() + input.days * 86400000 : 0,
            reason: input.reason,
            version: input.version + 1,
          };
          return { data, result: data, beforeAudit: before, afterAudit: data };
        },
      );
    },
    async networkAccounts(
      hash: string,
      day: string,
      limit: number,
      cursor?: string,
    ): Promise<AdminPage<AdminUser>> {
      const page = await storage.page(`ipStats/${hash}_${day}/accounts`, limit, cursor);
      const items = await Promise.all(
        page.items.map(async (member) => {
          const uid = String(member.uid);
          return adminUser(uid, (await storage.get(`users/${uid}`)) ?? {});
        }),
      );
      return { items, nextCursor: page.nextCursor };
    },
    async overview(includeAudit: boolean) {
      const counts = await storage.counts();
      const week = await Promise.all(
        Array.from({ length: 7 }, async (_, index) => {
          const day = new Date(Date.now() - (6 - index) * 86400000).toISOString().slice(0, 10);
          const stat = await storage.get(`dailyStats/global_${day}`);
          return { day, used: Math.max(0, Number(stat?.count ?? 0)) };
        }),
      );
      return {
        ...counts,
        activeAccounts: Math.max(
          0,
          counts.totalAccounts - counts.suspendedAccounts - counts.deletedAccounts,
        ),
        week,
        settings: await this.getSettings(),
        recentAudit: includeAudit ? (await this.audit(5)).items : [],
      };
    },
  };
}
export type AdminStore = ReturnType<typeof createAdminStore>;

export function createFirestoreAdminStorage(projectId: string): AdminStorage {
  const db = () => getFirestore(getFirebaseApp(projectId));
  const normalize = (data: Data): Data =>
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Timestamp ? value.toMillis() : value,
      ]),
    );
  const persist = (path: string, data: Data) =>
    path.startsWith('users/')
      ? Object.fromEntries(
          Object.entries(data).map(([key, value]) => [
            key,
            ['createdAt', 'lastLoginAt', 'updatedAt', 'deletedAt', 'suspendedUntil'].includes(
              key,
            ) && typeof value === 'number'
              ? Timestamp.fromMillis(value)
              : value,
          ]),
        )
      : data;
  return {
    async get(path) {
      const snap = await db().doc(path).get();
      return snap.exists ? normalize(snap.data()!) : null;
    },
    async page(collection, limit, cursor, descending = false) {
      let query = db()
        .collection(collection)
        .orderBy(descending ? 'createdAt' : FieldPath.documentId(), descending ? 'desc' : 'asc')
        .limit(limit + 1);
      if (cursor && descending) {
        const last = await db().collection(collection).doc(cursor).get();
        if (!last.exists)
          throw new AppError(
            400,
            'INVALID_CURSOR',
            'The audit cursor no longer exists. Refresh the list.',
          );
        query = query.startAfter(last);
      } else if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();
      return {
        items: snap.docs.slice(0, limit).map((doc) => ({ ...normalize(doc.data()), id: doc.id })),
        nextCursor: snap.size > limit ? snap.docs[limit - 1]!.id : null,
      };
    },
    async transaction(paths, fn) {
      return db().runTransaction(async (tx) => {
        const docs = await tx.getAll(...paths.map((path) => db().doc(path)));
        const { writes, result } = fn(
          docs.map((doc) => (doc.exists ? normalize(doc.data()!) : null)),
        );
        for (const write of writes) tx.set(db().doc(write.path), persist(write.path, write.data));
        return result;
      });
    },
    async counts() {
      const users = db().collection('users');
      const [total, suspended, deleted] = await Promise.all([
        users.count().get(),
        users.where('suspendedUntil', '>', Timestamp.now()).count().get(),
        users.where('deletedAt', '>', Timestamp.fromMillis(0)).count().get(),
      ]);
      return {
        totalAccounts: total.data().count,
        suspendedAccounts: suspended.data().count,
        deletedAccounts: deleted.data().count,
      };
    },
  };
}

export function createMemoryAdminStorage(users: Map<string, UserRecord> = new Map()): AdminStorage {
  const records = new Map<string, Data>();
  const read = (path: string): Data | null =>
    path.startsWith('users/')
      ? ((users.get(path.slice(6)) as unknown as Data) ?? null)
      : (records.get(path) ?? null);
  const write = (path: string, data: Data) => {
    if (path.startsWith('users/')) users.set(path.slice(6), data as unknown as UserRecord);
    else records.set(path, data);
  };
  return {
    async get(path) {
      return read(path);
    },
    async page(collection, limit, cursor, descending = false) {
      const rows =
        collection === 'users'
          ? [...users.entries()].map(([id, data]) => ({ ...data, id }))
          : [...records.entries()]
              .filter(
                ([path]) =>
                  path.startsWith(`${collection}/`) &&
                  !path.slice(collection.length + 1).includes('/'),
              )
              .map(([path, data]) => ({ ...data, id: path.slice(collection.length + 1) }));
      const sorted = rows
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * (descending ? -1 : 1))
        .filter((row) => !cursor || (descending ? row.id < cursor : row.id > cursor));
      return {
        items: sorted.slice(0, limit),
        nextCursor: sorted.length > limit ? sorted[limit - 1]!.id : null,
      };
    },
    async transaction(paths, fn) {
      const { writes, result } = fn(paths.map(read));
      for (const change of writes) write(change.path, change.data);
      return result;
    },
    async counts() {
      const rows = [...users.entries()].map(([uid, data]) =>
        adminUser(uid, data as unknown as Data),
      );
      return {
        totalAccounts: rows.length,
        suspendedAccounts: rows.filter((row) => row.status === 'suspended').length,
        deletedAccounts: rows.filter((row) => row.status === 'deleted').length,
      };
    },
  };
}
