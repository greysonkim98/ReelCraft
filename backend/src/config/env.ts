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
  /** Trusted proxy hops: 0 for direct connections, 1 for the configured Render deployment. */
  TRUST_PROXY_HOPS: intWithDefault(0),

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
  IPINFO_TOKEN: optionalString,
  /** Operator-maintained ASN watchlist; Lite does not report VPN/datacenter flags. */
  IPINFO_FLAGGED_ASNS: z
    .preprocess(emptyToUndefined, z.string().default(''))
    .transform((value) =>
      value
        .split(',')
        .map((asn) => asn.trim().toUpperCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^AS\d+$/))),
  /** Public Firebase web app ID, used to restrict App Check tokens to our frontend. */
  FIREBASE_WEB_APP_ID: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${names}`);
  }
  const env = parsed.data;
  if ((env.IPINFO_TOKEN || env.IP_DAILY_CAP > 0) && !env.IP_HASH_SALT) {
    throw new Error('IP_HASH_SALT is required when IPINFO_TOKEN or IP_DAILY_CAP is enabled.');
  }
  if (env.IPINFO_FLAGGED_ASNS.length && (!env.IPINFO_TOKEN || !env.FIREBASE_WEB_APP_ID)) {
    throw new Error('IPINFO_TOKEN and FIREBASE_WEB_APP_ID are required for IPINFO_FLAGGED_ASNS.');
  }
  if (env.NODE_ENV === 'production') {
    if (env.STORE === 'memory') {
      throw new Error(
        'STORE=memory is not allowed in production (counters would reset on every cold start).',
      );
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
