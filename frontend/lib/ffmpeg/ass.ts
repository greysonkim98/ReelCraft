import type { SubtitleStyleId } from '@reelcraft/shared';
import { SUBTITLE_RENDER } from './constants';

const PLAY_RES_X = 1080;
const PLAY_RES_Y = 1920;

interface AssStyle {
  fontSize: number;
  primary: string;
  outlineColour: string;
  backColour: string;
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  alignment: number;
  marginV: number;
}

// ASS colours are &HAABBGGRR (AA = 00 opaque, FF transparent).
const WHITE = '&H00FFFFFF';
const BLACK = '&H00000000';
const YELLOW = '&H0000FFFF';
const HALF_BLACK = '&H80000000';

export const ASS_STYLES: Record<SubtitleStyleId, AssStyle> = {
  // White, 4px black outline, bottom quarter of the frame.
  classic: {
    fontSize: 64,
    primary: WHITE,
    outlineColour: BLACK,
    backColour: BLACK,
    borderStyle: 1,
    outline: 4,
    shadow: 0,
    alignment: 2,
    marginV: PLAY_RES_Y / 4,
  },
  // White on a translucent black box (BorderStyle 3 draws the box in OutlineColour).
  box: {
    fontSize: 58,
    primary: WHITE,
    outlineColour: HALF_BLACK,
    backColour: HALF_BLACK,
    borderStyle: 3,
    outline: 14,
    shadow: 0,
    alignment: 2,
    marginV: 200,
  },
  // Bold yellow, 6px outline, a little below centre.
  pop: {
    fontSize: 80,
    primary: YELLOW,
    outlineColour: BLACK,
    backColour: BLACK,
    borderStyle: 1,
    outline: 6,
    shadow: 0,
    alignment: 2,
    marginV: 800,
  },
  // White, shadow only, generous bottom margin.
  minimal: {
    fontSize: 48,
    primary: WHITE,
    outlineColour: BLACK,
    backColour: '&H96000000',
    borderStyle: 1,
    outline: 0,
    shadow: 3,
    alignment: 2,
    marginV: 360,
  },
};

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|‍|️/gu;

/** Emoji cannot be rendered by the bundled font; drop them and normalise whitespace. */
export function sanitizeSubtitle(text: string): string {
  return text.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
}

/**
 * Splits text longer than `wrapAt` into balanced lines at word boundaries.
 * Up to 2×wrapAt characters gives two lines (the specified behaviour); longer text gets more.
 */
export function wrapSubtitle(text: string, wrapAt: number = SUBTITLE_RENDER.wrapAt): string[] {
  if (text.length <= wrapAt) return [text];
  const words = text.split(' ');
  const lineCount = Math.ceil(text.length / wrapAt);
  const target = text.length / lineCount;
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    const remainingLines = lineCount - lines.length - 1;
    // Break before this word when the line is already at/over target, or the word would
    // overflow, as long as another line is still available.
    const shouldBreak =
      current !== '' &&
      remainingLines > 0 &&
      (candidate.length > wrapAt || Math.abs(current.length - target) < Math.abs(candidate.length - target));
    if (shouldBreak) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

/**
 * Escapes ASS override characters. libass reads `\{` and `\}` as literal braces; a bare
 * backslash could start a command (`\N`), so it is replaced with a slash.
 */
export function escapeAss(text: string): string {
  return text.replace(/\\/g, '/').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

export function formatAssTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export interface AssSegment {
  /** Segment length on the output timeline (end - start of the source cut). */
  duration: number;
  subtitle: string;
}

/** Builds the .ass file; each subtitle shows for its segment's span on the final timeline. */
export function buildAss(segments: AssSegment[], styleId: SubtitleStyleId): string {
  const style = ASS_STYLES[styleId];
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${PLAY_RES_X}`,
    `PlayResY: ${PLAY_RES_Y}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      `Style: ${styleId}`,
      SUBTITLE_RENDER.fontFamily,
      style.fontSize,
      style.primary,
      style.primary,
      style.outlineColour,
      style.backColour,
      -1, // bold
      0,
      0,
      0,
      100,
      100,
      0,
      0,
      style.borderStyle,
      style.outline,
      style.shadow,
      style.alignment,
      60,
      60,
      style.marginV,
      1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const start = cursor;
    const end = cursor + seg.duration;
    cursor = end;
    const clean = sanitizeSubtitle(seg.subtitle);
    if (clean === '') continue;
    const text = wrapSubtitle(clean).map(escapeAss).join('\\N');
    events.push(
      `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},${styleId},,0,0,0,,${text}`,
    );
  }
  return [...header, ...events, ''].join('\n');
}
