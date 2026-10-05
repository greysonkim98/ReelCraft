import { createServer } from 'node:http';
import pino from 'pino';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { configureFirebase, parseServiceAccount } from './lib/firebase';
import { createFirebaseVerifier } from './services/auth';
import { createFirestoreProjectStore, createMemoryProjectStore } from './services/projects';
import { attachRealtime, noopNotifier, type Notifier } from './services/realtime';
import { createScriptService } from './services/script';
import { createFirestoreUsageStore, createMemoryUsageStore } from './services/usage';

const env = loadEnv();
const logger = pino({ level: 'info' });

if (!env.FIREBASE_PROJECT_ID) {
  logger.error('FIREBASE_PROJECT_ID is not set: sign-in tokens cannot be verified.');
  process.exit(1);
}
const projectId = env.FIREBASE_PROJECT_ID;
if (env.FIREBASE_SERVICE_ACCOUNT_JSON) configureFirebase(parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON));

// Firestore needs real credentials or its emulator. Without either (a plain local run), keep the
// counters in memory; production forbids this in loadEnv().
const useMemory =
  env.STORE === 'memory' ||
  (env.STORE === undefined && !process.env.FIRESTORE_EMULATOR_HOST && env.NODE_ENV !== 'production');
const usage = useMemory ? createMemoryUsageStore() : createFirestoreUsageStore(projectId);
const projects = useMemory ? createMemoryProjectStore() : createFirestoreProjectStore(projectId);
const verifier = createFirebaseVerifier(projectId);

const script = createScriptService({
  apiKey: env.GROQ_API_KEY,
  model: env.GROQ_MODEL,
  fallbackModel: env.GROQ_FALLBACK_MODEL,
});

// Socket.IO attaches to the HTTP server that wraps the app, so the app gets a notifier that
// forwards to the real one once it exists.
let realtime: Notifier = noopNotifier;
const notifier: Notifier = { notify: (uid, event, payload) => realtime.notify(uid, event, payload) };

const app = createApp({ env, script, verifier, usage, projects, notifier, logger });
const server = createServer(app);
realtime = attachRealtime(server, {
  verifier,
  projects,
  origins: env.CLIENT_ORIGIN.split(',').map((o) => o.trim()),
  logger,
});

server.listen(env.PORT, () => {
  logger.info(`ReelCraft backend listening on :${env.PORT} (${env.NODE_ENV}, store=${useMemory ? 'memory' : 'firestore'})`);
  if (!useMemory && !env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.FIRESTORE_EMULATOR_HOST) {
    logger.warn('No FIREBASE_SERVICE_ACCOUNT_JSON: relying on Google Cloud default credentials.');
  }
  if (useMemory) logger.warn('Usage counters and projects are kept in memory and reset on restart.');
  if (!env.GROQ_API_KEY) logger.warn('GROQ_API_KEY is not set: /ai/script will answer 500 CONFIG_MISSING.');
});
