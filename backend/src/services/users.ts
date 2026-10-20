import { ROLES, type Role, type Style } from '@reelcraft/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseApp } from '../lib/firebase';

export interface UserRecord {
  email?: string;
  /**
   * Access level. New accounts are 'user'. An admin is made by editing this field on users/{uid} in
   * the Firebase console: the server never grants or changes it, and clients cannot write it.
   */
  role: Role;
  /** The style picked first; new projects start from it. */
  style?: Style;
}

/** A missing or unknown value is the least privileged role. */
export const parseRole = (value: unknown): Role => (ROLES as readonly unknown[]).includes(value) ? (value as Role) : 'user';

/** users/{uid}: profile, role and default style. Clients may read their own document; only the server writes. */
export interface UserStore {
  /** Creates the profile on first sign-in, refreshes email and lastLoginAt afterwards. Never changes the role. */
  touch(uid: string, email?: string): Promise<UserRecord>;
  get(uid: string): Promise<UserRecord | null>;
  setStyle(uid: string, style: Style): Promise<void>;
}

/** `seed` lets tests start with accounts that already exist (e.g. an admin). */
export function createMemoryUserStore(seed: Record<string, Partial<UserRecord>> = {}): UserStore {
  const all = new Map<string, UserRecord>(
    Object.entries(seed).map(([uid, rec]) => [uid, { ...rec, role: parseRole(rec.role) }]),
  );
  return {
    async touch(uid, email) {
      const rec: UserRecord = { role: 'user', ...all.get(uid), ...(email ? { email } : {}) };
      all.set(uid, rec);
      return rec;
    },
    async get(uid) {
      return all.get(uid) ?? null;
    },
    async setStyle(uid, style) {
      all.set(uid, { role: 'user', ...all.get(uid), style });
    },
  };
}

export function createFirestoreUserStore(projectId: string): UserStore {
  const doc = (uid: string) => getFirestore(getFirebaseApp(projectId)).collection('users').doc(uid);
  const read = (data: FirebaseFirestore.DocumentData | undefined): UserRecord => ({
    email: data?.email,
    role: parseRole(data?.role),
    style: data?.style,
  });
  return {
    async touch(uid, email) {
      const ref = doc(uid);
      const snap = await ref.get();
      // `role` is written only when the profile is created, so a role set by hand is never overwritten.
      await ref.set(
        {
          ...(email ? { email } : {}),
          lastLoginAt: FieldValue.serverTimestamp(),
          ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp(), role: 'user' }),
        },
        { merge: true },
      );
      return { ...read(snap.data()), ...(email ? { email } : {}) };
    },
    async get(uid) {
      const snap = await doc(uid).get();
      return snap.exists ? read(snap.data()) : null;
    },
    async setStyle(uid, style) {
      await doc(uid).set({ style }, { merge: true });
    },
  };
}
