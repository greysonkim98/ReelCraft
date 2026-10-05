import path from 'node:path';
import { DEFAULT_LIMITS, GROQ_MODELS } from '@reelcraft/shared';
import dotenv from 'dotenv';
import { z } from 'zod';

// Repo-root .env (works from both src/ via tsx and dist/ after tsc: three levels up).
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const intWithDefault = (def: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).default(def));

const envSchema = z.object({
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(4000)),
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'production', 'test']).default('development'),
  ),
  CLIENT_ORIGIN: z.preprocess(emptyToUndefined, z.string().default('http://localhost:3000')),
  /** Number of reverse proxies in front of the app (Cloud Run behind Firebase Hosting: verify). */
  TRUST_PROXY_HOPS: intWithDefault(1),

  // Groq (checked when a request needs it, with a message naming the variable).
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.preprocess(emptyToUndefined, z.string().default(GROQ_MODELS.primary)),
  GROQ_FALLBACK_MODEL: z.preprocess(emptyToUndefined, z.string().default(GROQ_MODELS.fallback)),

  // Firebase. On Cloud Run the Admin SDK uses the service account automatically, so only the
  // project id is needed. Locally, set FIREBASE_AUTH_EMULATOR_HOST to accept emulator tokens.
  FIREBASE_PROJECT_ID: optionalString,
  /** Service account key (JSON or base64 JSON) for hosts outside Google Cloud, such as Render. */
  FIREBASE_SERVICE_ACCOUNT_JSON: optionalString,
  /** Set to "memory" to keep usage and projects in process memory (dev/tests only). */
  STORE: z.preprocess(emptyToUndefined, z.enum(['firestore', 'memory']).optional()),

  AI_PER_USER_PER_DAY: intWithDefault(DEFAULT_LIMITS.aiPerUserPerDay),
  GLOBAL_DAILY_AI_CAP: intWithDefault(DEFAULT_LIMITS.globalDailyAiCap),
  /** 0 disables the per-IP cap. */
  IP_DAILY_CAP: intWithDefault(DEFAULT_LIMITS.ipDailyCap),
  IP_HASH_SALT: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${names}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.STORE === 'memory') {
      throw new Error('STORE=memory is not allowed in production (counters would reset on every cold start).');
    }
    if (!env.FIREBASE_PROJECT_ID) {
      throw new Error('FIREBASE_PROJECT_ID is required in production.');
    }
    if (env.IP_DAILY_CAP > 0 && !env.IP_HASH_SALT) {
      throw new Error('IP_HASH_SALT is required when IP_DAILY_CAP is enabled.');
    }
  }
  return env;
}
