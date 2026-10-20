import type { ProgressStage, ProjectPatch, Scene, Script, Style } from '@reelcraft/shared';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseApp } from '../lib/firebase';

export interface ProjectRecord {
  uid: string;
  title?: string;
  style?: Style;
  userPrompt: string;
  userMemos: string[];
  scenes: Scene[];
  script: Script;
  source: 'llm' | 'fallback';
  model: string | null;
  stage: ProgressStage;
  percent: number;
}

/**
 * Render job state, kept so the work can be recovered after a restart. Only text lives here:
 * scenes.json and script JSON. Clients may read their own documents; only the server writes.
 */
export interface ProjectStore {
  create(id: string, record: ProjectRecord): Promise<void>;
  get(id: string): Promise<ProjectRecord | null>;
  setStage(id: string, stage: ProgressStage, percent: number, message?: string): Promise<void>;
  /** Newest first, one user's projects only. */
  listByUser(uid: string, limit?: number): Promise<(ProjectRecord & { id: string })[]>;
  update(id: string, patch: ProjectPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createMemoryProjectStore(): ProjectStore & { all: Map<string, ProjectRecord> } {
  const all = new Map<string, ProjectRecord>();
  return {
    all,
    async create(id, record) {
      all.set(id, record);
    },
    async get(id) {
      return all.get(id) ?? null;
    },
    async setStage(id, stage, percent) {
      const rec = all.get(id);
      if (rec) all.set(id, { ...rec, stage, percent });
    },
    async listByUser(uid, limit = 50) {
      return [...all.entries()]
        .filter(([, r]) => r.uid === uid)
        .reverse()
        .slice(0, limit)
        .map(([id, r]) => ({ id, ...r }));
    },
    async update(id, patch) {
      const rec = all.get(id);
      if (rec) all.set(id, { ...rec, ...patch });
    },
    async remove(id) {
      all.delete(id);
    },
  };
}

export function createFirestoreProjectStore(projectId: string): ProjectStore {
  const col = () => getFirestore(getFirebaseApp(projectId)).collection('projects');
  return {
    async create(id, record) {
      await col().doc(id).set({ ...record, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    },
    async get(id) {
      const snap = await col().doc(id).get();
      return snap.exists ? (snap.data() as ProjectRecord) : null;
    },
    async setStage(id, stage, percent, message) {
      await col()
        .doc(id)
        .set({ stage, percent, ...(message ? { message } : {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
    async listByUser(uid, limit = 50) {
      const snap = await col().where('uid', '==', uid).orderBy('updatedAt', 'desc').limit(limit).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as ProjectRecord) }));
    },
    async update(id, patch) {
      await col().doc(id).set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
    async remove(id) {
      await col().doc(id).delete();
    },
  };
}
