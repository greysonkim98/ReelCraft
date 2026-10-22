import { z } from 'zod';
import { ROLES } from './constants';

export const runtimeLimitsSchema = z
  .object({
    aiPerUserPerDay: z.number().int().min(0).max(10000),
    globalDailyAiCap: z.number().int().min(0).max(10000),
    ipDailyCap: z.number().int().min(0).max(10000),
    maxClips: z.number().int().min(1).max(30),
    maxOutputSeconds: z.number().int().min(3).max(60),
  })
  .strict();
export type RuntimeLimits = z.infer<typeof runtimeLimitsSchema>;
export interface RuntimeSettings {
  limits: RuntimeLimits;
  version: number;
  updatedAt: number | null;
}
const reason = z.string().trim().min(3).max(500);
export const userActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('role'),
      role: z.enum(ROLES),
      reason,
      version: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('suspend'),
      days: z.number().int().min(1).max(365),
      reason,
      version: z.number().int().nonnegative(),
    })
    .strict(),
  ...(['unsuspend', 'delete', 'restore'] as const).map((action) =>
    z
      .object({ action: z.literal(action), reason, version: z.number().int().nonnegative() })
      .strict(),
  ),
]);
export type UserAction = z.infer<typeof userActionSchema>;
export const settingsUpdateSchema = z
  .object({ limits: runtimeLimitsSchema, reason, version: z.number().int().nonnegative() })
  .strict();
export const networkActionSchema = z
  .object({
    blocked: z.boolean(),
    days: z.number().int().min(1).max(365),
    reason,
    version: z.number().int().nonnegative(),
  })
  .strict();
export type NetworkAction = z.infer<typeof networkActionSchema>;
export interface AdminUser {
  uid: string;
  email: string | null;
  name: string | null;
  role: (typeof ROLES)[number];
  status: 'active' | 'suspended' | 'deleted';
  suspendedUntil: number | null;
  deletedAt: number | null;
  reason: string | null;
  createdAt: number | null;
  lastLoginAt: number | null;
  version: number;
  aiUsedToday?: number;
}
export interface AuditEntry {
  id: string;
  actorUid: string;
  actorEmail: string | null;
  actorRole: string;
  action: string;
  target: string;
  reason: string;
  createdAt: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}
export interface AdminPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface NetworkRestriction {
  expiresAt: number;
  reason: string;
  version: number;
}
export interface NetworkDetails {
  restriction: NetworkRestriction | null;
  accounts: AdminPage<AdminUser>;
}
export interface AdminOverview {
  totalAccounts: number;
  activeAccounts: number;
  suspendedAccounts: number;
  deletedAccounts: number;
  week: { day: string; used: number }[];
  settings: RuntimeSettings;
  recentAudit: AuditEntry[];
}
