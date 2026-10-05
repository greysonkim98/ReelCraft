import { z } from 'zod';
import {
  COLOR_LOOKS,
  NOTE_MAX_CHARS,
  QUALITIES,
  SCENES_MAX_COUNT,
  SCENES_TOTAL_MAX_SECONDS,
  SCENE_MAX_SECONDS,
  SCRIPT_TITLE_MAX_CHARS,
  SEGMENTS_MAX_COUNT,
  SUBTITLE_ABS_MAX_CHARS,
  SUBTITLE_LANGUAGES,
  SUBTITLE_STYLES,
  TEMPOS,
  USER_MEMOS_MAX_COUNT,
  USER_MEMO_MAX_CHARS,
  USER_PROMPT_MAX_CHARS,
} from './constants';

export const colorLookSchema = z.enum(COLOR_LOOKS);
export const subtitleStyleSchema = z.enum(SUBTITLE_STYLES);
export const tempoSchema = z.enum(TEMPOS);
export const qualitySchema = z.enum(QUALITIES);

export const styleSchema = z.object({
  color: colorLookSchema,
  subtitle: subtitleStyleSchema,
  tempo: tempoSchema,
  quality: qualitySchema,
});

export const clipNoteSchema = z.object({
  index: z.number().int().min(0),
  note: z.string().max(NOTE_MAX_CHARS).default(''),
});

export const segmentRequestSchema = z.object({
  id: z.string().min(1).max(40),
  clipIndex: z.number().int().min(0),
  duration: z.number().positive().max(60),
  maxChars: z.number().int().min(1).max(SUBTITLE_ABS_MAX_CHARS),
});

/** Body of subtitle generation (the LLM-facing part of POST /ai/generate). */
export const subtitleRequestSchema = z.object({
  clips: z.array(clipNoteSchema).min(1),
  segments: z.array(segmentRequestSchema).min(1).max(SEGMENTS_MAX_COUNT),
  tone: tempoSchema,
  language: z.enum(SUBTITLE_LANGUAGES).default('en'),
});

export type SubtitleRequest = z.infer<typeof subtitleRequestSchema>;
export type SubtitleRequestInput = z.input<typeof subtitleRequestSchema>;

export const llmResponseSchema = z.object({
  lines: z.array(z.object({ id: z.string(), text: z.string() })),
});

const tagList = z.array(z.string().trim().min(1).max(30)).max(6).default([]);

/** One scene picked on the device. Text only: no frames, no file paths ever cross the wire. */
export const sceneSchema = z
  .object({
    scene_id: z.string().min(1).max(40),
    start: z.number().min(0),
    end: z.number().positive(),
    mood: tagList,
    setting: tagList,
    people: z.boolean().default(false),
    hearted: z.boolean().default(false),
    score: z.number().min(0).max(1).default(0),
    max_chars: z.number().int().min(1).max(SUBTITLE_ABS_MAX_CHARS),
  })
  .refine((s) => s.end > s.start, { message: 'end must be greater than start', path: ['end'] })
  .refine((s) => s.end - s.start <= SCENE_MAX_SECONDS, {
    message: `a scene can be at most ${SCENE_MAX_SECONDS} seconds`,
    path: ['end'],
  });

/** scenes.json: device -> Cloud Run (POST /ai/script). */
export const scriptRequestSchema = z
  .object({
    scenes: z.array(sceneSchema).min(1).max(SCENES_MAX_COUNT),
    userPrompt: z.string().trim().min(1).max(USER_PROMPT_MAX_CHARS),
    userMemos: z.array(z.string().trim().min(1).max(USER_MEMO_MAX_CHARS)).max(USER_MEMOS_MAX_COUNT).default([]),
  })
  .superRefine((req, ctx) => {
    const ids = new Set<string>();
    req.scenes.forEach((s, i) => {
      if (ids.has(s.scene_id)) {
        ctx.addIssue({ code: 'custom', message: 'duplicate scene_id', path: ['scenes', i, 'scene_id'] });
      }
      ids.add(s.scene_id);
    });
    const total = req.scenes.reduce((sum, s) => sum + (s.end - s.start), 0);
    if (total > SCENES_TOTAL_MAX_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        message: `scenes add up to ${total.toFixed(1)} s, max ${SCENES_TOTAL_MAX_SECONDS} s`,
        path: ['scenes'],
      });
    }
  });

export type Scene = z.infer<typeof sceneSchema>;
export type ScriptRequest = z.infer<typeof scriptRequestSchema>;
export type ScriptRequestInput = z.input<typeof scriptRequestSchema>;

export const scriptSceneSchema = z.object({
  scene_id: z.string(),
  caption: z.string(),
  /** null = no voiceover for this scene (subtitle only). */
  voiceover: z.string().nullable(),
  /** Place word taken from userMemos, or null. */
  location_text: z.string().nullable(),
});

/** script JSON: Cloud Run -> device. */
export const scriptSchema = z.object({
  title: z.string().max(SCRIPT_TITLE_MAX_CHARS * 2),
  scenes: z.array(scriptSceneSchema),
});

export type ScriptScene = z.infer<typeof scriptSceneSchema>;
export type Script = z.infer<typeof scriptSchema>;

export const PROGRESS_STAGES = [
  'importing',
  'analyzing',
  'scenes_ready',
  'script_ready',
  'tts',
  'rendering',
  'done',
  'failed',
] as const;
export type ProgressStage = (typeof PROGRESS_STAGES)[number];

/** Device -> server over Socket.IO ("project:progress"). */
export const progressEventSchema = z.object({
  projectId: z.string().min(1).max(64),
  stage: z.enum(PROGRESS_STAGES),
  percent: z.number().min(0).max(100),
  message: z.string().max(200).optional(),
});
export type ProgressEvent = z.infer<typeof progressEventSchema>;
