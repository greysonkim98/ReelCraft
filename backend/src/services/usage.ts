import type { UsageInfo } from '@reelcraft/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseApp } from '../lib/firebase';

export interface UsageLimits {
  perUser: number;
  global: number;
  /** 0 disables the per-IP cap */
  perIp: number;
}

export type ConsumeResult =
  | { ok: true; usage: UsageInfo }
  | { ok: false; reason: 'user' | 'global' | 'ip'; usage: UsageInfo };

export interface AiLogEntry {
  uid: string;
  projectId: string;
  model: string | null;
  source: 'llm' | 'fallback';
  calls: number;
  scenes: number;
}

/**
 * Daily counters per account, per IP hash and for the whole service. All writes happen on the
 * server (Admin SDK); Firestore rules deny every client write, so a user cannot reset their own
 * counter. consume() checks and increments in one transaction.
 */
export interface UsageStore {
  consume(uid: string, day: string, limits: UsageLimits, ipHash?: string): Promise<ConsumeResult>;
  /** Gives back one use (nothing was spent upstream, e.g. the LLM was unreachable). */
  refund(uid: string, day: string, ipHash?: string): Promise<void>;
  get(uid: string, day: string, limits: UsageLimits): Promise<UsageInfo>;
  logAi(entry: AiLogEntry): Promise<void>;
}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export const nextResetIso = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();

const info = (used: number, limit: number): UsageInfo => ({
  used,
  limit,
  remaining: Math.max(0, limit - used),
  resetAt: nextResetIso(),
});

export function createMemoryUsageStore(): UsageStore & { logs: AiLogEntry[] } {
  const counters = new Map<string, number>();
  const logs: AiLogEntry[] = [];
  const read = (k: string) => counters.get(k) ?? 0;
  const keys = (uid: string, day: string, ipHash?: string) => ({
    user: `u_${uid}_${day}`,
    global: `global_${day}`,
    ip: ipHash ? `ip_${ipHash}_${day}` : undefined,
  });
  return {
    logs,
    async consume(uid, day, limits, ipHash) {
      const k = keys(uid, day, ipHash);
      const usage = info(read(k.user), limits.perUser);
      if (read(k.user) >= limits.perUser) return { ok: false, reason: 'user', usage };
      if (read(k.global) >= limits.global) return { ok: false, reason: 'global', usage };
      if (k.ip && limits.perIp > 0 && read(k.ip) >= limits.perIp) return { ok: false, reason: 'ip', usage };
      counters.set(k.user, read(k.user) + 1);
      counters.set(k.global, read(k.global) + 1);
      if (k.ip) counters.set(k.ip, read(k.ip) + 1);
      return { ok: true, usage: info(read(k.user), limits.perUser) };
    },
    async refund(uid, day, ipHash) {
      const k = keys(uid, day, ipHash);
      for (const key of [k.user, k.global, k.ip]) {
        if (key) counters.set(key, Math.max(0, read(key) - 1));
      }
    },
    async get(uid, day, limits) {
      return info(read(`u_${uid}_${day}`), limits.perUser);
    },
    async logAi(entry) {
      logs.push(entry);
    },
  };
}

export function createFirestoreUsageStore(projectId: string): UsageStore {
  const db = () => getFirestore(getFirebaseApp(projectId));
  const ref = (id: string) => db().collection('dailyStats').doc(id);
  return {
    async consume(uid, day, limits, ipHash) {
      const userRef = ref(`u_${uid}_${day}`);
      const globalRef = ref(`global_${day}`);
      const ipRef = ipHash && limits.perIp > 0 ? ref(`ip_${ipHash}_${day}`) : null;
      return db().runTransaction(async (tx) => {
        const [u, g, i] = await Promise.all([tx.get(userRef), tx.get(globalRef), ipRef ? tx.get(ipRef) : null]);
        const used = (u.data()?.count as number | undefined) ?? 0;
        const usage = info(used, limits.perUser);
        if (used >= limits.perUser) return { ok: false, reason: 'user', usage } as const;
        if (((g.data()?.count as number | undefined) ?? 0) >= limits.global) {
          return { ok: false, reason: 'global', usage } as const;
        }
        if (ipRef && ((i?.data()?.count as number | undefined) ?? 0) >= limits.perIp) {
          return { ok: false, reason: 'ip', usage } as const;
        }
        const bump = { count: FieldValue.increment(1), day, updatedAt: FieldValue.serverTimestamp() };
        tx.set(userRef, { ...bump, uid }, { merge: true });
        tx.set(globalRef, bump, { merge: true });
        if (ipRef) tx.set(ipRef, bump, { merge: true });
        return { ok: true, usage: info(used + 1, limits.perUser) } as const;
      });
    },
    async refund(uid, day, ipHash) {
      const dec = { count: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() };
      const batch = db().batch();
      batch.set(ref(`u_${uid}_${day}`), dec, { merge: true });
      batch.set(ref(`global_${day}`), dec, { merge: true });
      if (ipHash) batch.set(ref(`ip_${ipHash}_${day}`), dec, { merge: true });
      await batch.commit();
    },
    async get(uid, day, limits) {
      const snap = await ref(`u_${uid}_${day}`).get();
      return info((snap.data()?.count as number | undefined) ?? 0, limits.perUser);
    },
    async logAi(entry) {
      await db().collection('aiUsage').add({ ...entry, createdAt: FieldValue.serverTimestamp() });
    },
  };
}
