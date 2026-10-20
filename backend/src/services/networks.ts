import { createHash } from 'node:crypto';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import type { NetworkActivity, NetworkActivityResponse } from '@reelcraft/shared';
import { getFirebaseApp } from '../lib/firebase';
import type { IpInfoCache, IpInfoCacheEntry } from './ipinfo';

export interface NetworkStore {
  cache: IpInfoCache;
  record(uid: string, activity: Omit<NetworkActivity, 'requests' | 'accountCount'>): Promise<void>;
  list(day: string, limit: number, cursor?: string): Promise<NetworkActivityResponse>;
  canRead(uid: string): Promise<boolean>;
  verifiedUntil(uid: string, ipHash: string): Promise<number>;
  markVerified(uid: string, ipHash: string, expiresAt: number): Promise<void>;
}
const verificationId = (uid: string, hash: string) =>
  createHash('sha256')
    .update(JSON.stringify([uid, hash]))
    .digest('hex');

export function createMemoryNetworkStore() {
  const cache = new Map<string, IpInfoCacheEntry>();
  const activity = new Map<string, NetworkActivity>();
  const accounts = new Map<string, Set<string>>();
  const roles = new Map<string, string>();
  const verified = new Map<string, number>();
  const store: NetworkStore = {
    cache: {
      async get(hash) {
        return cache.get(hash) ?? null;
      },
      async set(hash, entry) {
        cache.set(hash, entry);
      },
    },
    async record(uid, entry) {
      const id = `${entry.ipHash}_${entry.day}`;
      const uids = accounts.get(id) ?? new Set<string>();
      uids.add(uid);
      accounts.set(id, uids);
      activity.set(id, {
        ...entry,
        requests: (activity.get(id)?.requests ?? 0) + 1,
        accountCount: uids.size,
      });
    },
    async list(day, limit, cursor) {
      const rows = [...activity.entries()]
        .filter(([id, row]) => row.day === day && (!cursor || id > cursor))
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, limit + 1);
      return {
        day,
        items: rows.slice(0, limit).map(([, row]) => row),
        nextCursor: rows.length > limit ? rows[limit - 1]![0] : null,
      };
    },
    async canRead(uid) {
      return ['support', 'admin'].includes(roles.get(uid) ?? 'user');
    },
    async verifiedUntil(uid, hash) {
      return verified.get(verificationId(uid, hash)) ?? 0;
    },
    async markVerified(uid, hash, until) {
      verified.set(verificationId(uid, hash), until);
    },
  };
  return Object.assign(store, { activity, roles });
}

export function createFirestoreNetworkStore(projectId: string): NetworkStore {
  const db = () => getFirestore(getFirebaseApp(projectId));
  return {
    cache: {
      async get(hash) {
        const snap = await db().collection('ipInfoCache').doc(hash).get();
        return snap.exists ? (snap.data() as IpInfoCacheEntry) : null;
      },
      async set(hash, entry) {
        await db().collection('ipInfoCache').doc(hash).set(entry);
      },
    },
    async record(uid, entry) {
      const ref = db().collection('ipStats').doc(`${entry.ipHash}_${entry.day}`);
      // A membership document keeps distinct account counting atomic without an ever-growing array.
      const member = ref.collection('accounts').doc(createHash('sha256').update(uid).digest('hex'));
      await db().runTransaction(async (tx) => {
        const [stat, account] = await Promise.all([tx.get(ref), tx.get(member)]);
        tx.set(ref, {
          ...entry,
          requests: (stat.data()?.requests ?? 0) + 1,
          accountCount: (stat.data()?.accountCount ?? 0) + (account.exists ? 0 : 1),
        });
        if (!account.exists) tx.set(member, { uid });
      });
    },
    async list(day, limit, cursor) {
      let query = db()
        .collection('ipStats')
        .where('day', '==', day)
        .orderBy(FieldPath.documentId())
        .limit(limit + 1);
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();
      return {
        day,
        items: snap.docs.slice(0, limit).map((doc) => doc.data() as NetworkActivity),
        nextCursor: snap.docs.length > limit ? snap.docs[limit - 1]!.id : null,
      };
    },
    async canRead(uid) {
      const user = (await db().collection('users').doc(uid).get()).data();
      return Boolean(
        user &&
        !user.deletedAt &&
        !(user.suspendedUntil?.toMillis() > Date.now()) &&
        ['support', 'admin'].includes(user.role),
      );
    },
    async verifiedUntil(uid, hash) {
      const snap = await db()
        .collection('networkVerifications')
        .doc(verificationId(uid, hash))
        .get();
      return snap.data()?.expiresAt ?? 0;
    },
    async markVerified(uid, hash, expiresAt) {
      await db()
        .collection('networkVerifications')
        .doc(verificationId(uid, hash))
        .set({ expiresAt });
    },
  };
}
