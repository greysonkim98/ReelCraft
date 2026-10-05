import { describe, expect, it } from 'vitest';
import { buildAss, escapeAss, formatAssTime, sanitizeSubtitle, wrapSubtitle } from './ass';

describe('subtitle text handling', () => {
  it('removes emoji and collapses whitespace', () => {
    expect(sanitizeSubtitle('Waves  🌊 hit 👩‍👩‍👧 different ❤️')).toBe('Waves hit different');
  });

  it('keeps short text on one line', () => {
    expect(wrapSubtitle('Waves hit different')).toEqual(['Waves hit different']);
    expect(wrapSubtitle('a'.repeat(28))).toHaveLength(1);
  });

  it('wraps text over 28 chars into two balanced lines at word boundaries', () => {
    const lines = wrapSubtitle('Salt air and zero plans at the arboretum today');
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe('Salt air and zero plans at the arboretum today');
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(28));
  });

  it('uses more lines for very long text rather than overflowing', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
    const lines = wrapSubtitle(text);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.join(' ')).toBe(text);
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(28));
  });

  it('escapes ASS override characters', () => {
    expect(escapeAss('a {b} c')).toBe('a \\{b\\} c');
    // a bare backslash must not be able to form \N or a tag
    expect(escapeAss('a\\Nb')).toBe('a/Nb');
  });
});

describe('formatAssTime', () => {
  it('formats h:mm:ss.cc', () => {
    expect(formatAssTime(0)).toBe('0:00:00.00');
    expect(formatAssTime(1.5)).toBe('0:00:01.50');
    expect(formatAssTime(61.234)).toBe('0:01:01.23');
    expect(formatAssTime(3600)).toBe('1:00:00.00');
  });
});

describe('buildAss', () => {
  const segs = [
    { duration: 1.5, subtitle: 'Waves hit different' },
    { duration: 2, subtitle: 'Salt air {and} zero plans at the arboretum 🌊' },
    { duration: 1, subtitle: '   ' },
    { duration: 1, subtitle: 'Ducks' },
  ];

  it('has a 1080x1920 canvas and the chosen style', () => {
    const ass = buildAss(segs, 'pop');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toMatch(/^Style: pop,Noto Sans,80,&H0000FFFF/m);
  });

  it('places each line on the final timeline and skips empty subtitles', () => {
    const ass = buildAss(segs, 'classic');
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(dialogues).toHaveLength(3);
    expect(dialogues[0]).toContain('0:00:00.00,0:00:01.50,classic');
    expect(dialogues[1]).toContain('0:00:01.50,0:00:03.50,classic');
    // empty segment still occupies 1s of timeline, so the next line starts at 4.5s
    expect(dialogues[2]).toContain('0:00:04.50,0:00:05.50,classic');
  });

  it('wraps with \\N, escapes braces and drops emoji in the dialogue text', () => {
    const ass = buildAss(segs, 'classic');
    const line = ass.split('\n').find((l) => l.includes('arboretum'))!;
    expect(line).toContain('\\N');
    expect(line).toContain('\\{and\\}');
    expect(line).not.toContain('🌊');
  });

  it('box style uses BorderStyle 3 and classic sits a quarter up from the bottom', () => {
    expect(buildAss(segs, 'box')).toMatch(/^Style: box,.*,3,14,0,2,60,60,200,1$/m);
    expect(buildAss(segs, 'classic')).toMatch(/,1,4,0,2,60,60,480,1$/m);
  });
});
