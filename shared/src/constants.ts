export const ROLES = ['user', 'support', 'admin'] as const;
export const COLOR_LOOKS = ['natural', 'warm', 'cool', 'vivid', 'film', 'mono'] as const;
export const SUBTITLE_STYLES = ['classic', 'box', 'pop', 'minimal'] as const;
export const TEMPOS = ['energetic', 'calm'] as const;
/** 9:16 at 720x1280 is enough for Reels and keeps phone memory and render time down. */
export const QUALITIES = ['720p'] as const;
export const SUBTITLE_LANGUAGES = ['en'] as const;

export const VOICES = [
  { id: 'af_heart', label: 'Heart', accent: 'US', gender: 'female' },
  { id: 'af_bella', label: 'Bella', accent: 'US', gender: 'female' },
  { id: 'af_nicole', label: 'Nicole', accent: 'US', gender: 'female' },
  { id: 'af_sarah', label: 'Sarah', accent: 'US', gender: 'female' },
  { id: 'af_sky', label: 'Sky', accent: 'US', gender: 'female' },
  { id: 'am_michael', label: 'Michael', accent: 'US', gender: 'male' },
  { id: 'am_adam', label: 'Adam', accent: 'US', gender: 'male' },
  { id: 'am_puck', label: 'Puck', accent: 'US', gender: 'male' },
  { id: 'bf_emma', label: 'Emma', accent: 'UK', gender: 'female' },
  { id: 'bf_isabella', label: 'Isabella', accent: 'UK', gender: 'female' },
  { id: 'bm_george', label: 'George', accent: 'UK', gender: 'male' },
  { id: 'bm_lewis', label: 'Lewis', accent: 'UK', gender: 'male' },
] as const;
export const DEFAULT_VOICE_ID = 'af_heart' as const;

export const VOICE_SPEED = { min: 0.8, max: 1.2, default: 1.0 } as const;

/** Groq free tier: gpt-oss-20b is the smallest chat model with strict structured outputs. */
export const GROQ_MODELS = {
  primary: 'openai/gpt-oss-20b',
} as const;

/**
 * Groq vision model (image + text in, JSON out). Checked against GET /models on 2026-10-16: the only
 * generally available vision model (Llama 4 Scout/Maverick are no longer listed). Free tier is
 * 8K tokens/min and 200K/day, and one image costs about 1.3-1.8K tokens whatever its size, so the
 * device packs the scenes into at most 2 labeled grid images. One request per project, no retries.
 * The list changes often: override with GROQ_VISION_MODEL if this is retired.
 */
export const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';

/**
 * Free tier input is 7000 tokens/min and one image costs about 2048, so a project sends at most 2
 * images (Groq itself would accept 3). Each is a 2x2 grid of labeled scenes.
 */
export const REEL_IMAGES_MAX = 2;
/** Scenes shown to the model per project (2 grid images of up to 4 scenes each). */
export const REEL_IMAGE_SCENES_MAX = 8;
/** Base64 length of one grid JPEG. */
export const REEL_IMAGE_MAX_BASE64_CHARS = 150_000;

/**
 * Product limits. The AI caps follow Groq's free tier (200K tokens/day shared by the whole
 * organization, about 2-3K tokens per render): globalDailyAiCap keeps one day's renders under it.
 */
export const DEFAULT_LIMITS = {
  /** Sum of all clip sizes, checked in the browser from File.size. */
  maxTotalMB: 300,
  maxClipSeconds: 600,
  maxOutputSeconds: 60,
  aiPerUserPerDay: 3,
  /** Per-account AI quota for admins. Still counts against globalDailyAiCap. */
  adminAiPerUserPerDay: 100,
  ttsDailyLines: 30,
  /** 0 disables the per-IP cap (needs a verified proxy setup first). */
  ipDailyCap: 0,
  accountsPerDeviceWarn: 2,
  globalDailyAiCap: 60,
} as const;

export const SCENES_MAX_COUNT = 30;
export const USER_MEMOS_MAX_COUNT = 20;
export const USER_MEMO_MAX_CHARS = 150;
export const USER_PROMPT_MAX_CHARS = 200;
export const SCRIPT_TITLE_MAX_CHARS = 40;
/** Scene length bounds used when validating a scenes request (device picks 2-6 s). */
export const SCENE_MAX_SECONDS = 10;
export const SCENES_TOTAL_MAX_SECONDS = 65;

export const NOTE_MAX_CHARS = 150;
export const SEGMENTS_MAX_COUNT = 60;
export const SUBTITLE_ABS_MAX_CHARS = 80;
export const SUBTITLE_ABS_MIN_CHARS = 12;
/** Reading speed used to derive a segment's max subtitle length. */
export const SUBTITLE_CHARS_PER_SECOND = 15;

/** maxChars = clamp(round(seconds * 15), 12, 80) */
export function computeMaxChars(seconds: number): number {
  const raw = Math.round(seconds * SUBTITLE_CHARS_PER_SECOND);
  return Math.min(SUBTITLE_ABS_MAX_CHARS, Math.max(SUBTITLE_ABS_MIN_CHARS, raw));
}
