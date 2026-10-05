import type {
  COLOR_LOOKS,
  QUALITIES,
  ROLES,
  SUBTITLE_LANGUAGES,
  SUBTITLE_STYLES,
  TEMPOS,
  VOICES,
} from './constants';

export type Role = (typeof ROLES)[number];
export type ColorLook = (typeof COLOR_LOOKS)[number];
export type SubtitleStyleId = (typeof SUBTITLE_STYLES)[number];
export type Tempo = (typeof TEMPOS)[number];
export type Quality = (typeof QUALITIES)[number];
export type SubtitleLanguage = (typeof SUBTITLE_LANGUAGES)[number];
export type VoiceId = (typeof VOICES)[number]['id'];

export interface ClipMeta {
  name: string;
  size: number;
  duration: number;
  fingerprint: string;
  note: string;
}

export interface Segment {
  id: string;
  clipIndex: number;
  start: number;
  end: number;
  score?: number;
  subtitle: string;
  maxChars: number;
  editedByUser: boolean;
}

export interface Style {
  color: ColorLook;
  subtitle: SubtitleStyleId;
  tempo: Tempo;
  quality: Quality;
}

export interface Voice {
  enabled: boolean;
  voiceId: VoiceId;
  speed: number;
}

export interface Project {
  title: string;
  clips: ClipMeta[];
  segments: Segment[];
  style: Style;
  voice: Voice;
}

export interface SubtitleLine {
  id: string;
  text: string;
}

export interface GenerateSubtitlesResponse {
  lines: SubtitleLine[];
  provider: 'cerebras' | 'groq';
  fellBack: boolean;
}

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export interface UsageInfo {
  used: number;
  limit: number;
  remaining: number;
  /** ISO time of the next reset (00:00 UTC, the same moment Groq resets its own daily quota). */
  resetAt: string;
}

export interface GenerateScriptResponse {
  projectId: string;
  script: import('./schemas').Script;
  /** 'fallback' = the LLM was unavailable and the script was built from memos and tags. */
  source: 'llm' | 'fallback';
  model: string | null;
  usage: UsageInfo;
}
