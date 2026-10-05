import type { ScriptRequest } from '@reelcraft/shared';
import { vi } from 'vitest';
import type { TokenVerifier } from '../src/services/auth';

export function makeScenes(n: number, maxChars = 20) {
  return Array.from({ length: n }, (_, i) => ({
    scene_id: `s${String(i + 1).padStart(2, '0')}`,
    start: i * 4,
    end: i * 4 + 3,
    mood: ['calm'],
    setting: ['beach'],
    people: false,
    hearted: i === 0,
    score: 0.5,
    max_chars: maxChars,
  }));
}

export function makeRequest(n = 3, overrides: Partial<ScriptRequest> = {}): ScriptRequest {
  return {
    scenes: makeScenes(n),
    userPrompt: 'relaxing travel reel',
    userMemos: ['Busan day 1', 'Gwangalli beach'],
    ...overrides,
  };
}

export const llmLine = (scene_id: string, caption = 'Slow golden light', extra: object = {}) => ({
  scene_id,
  caption,
  voiceover: caption,
  location_text: null,
  ...extra,
});

export const groqBody = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

export const httpStatus = (status: number) => new Response('{}', { status });

/** Records every request body and answers from a queue (an Error in the queue is thrown). */
export function fakeGroq(queue: (Response | Error)[]) {
  const requests: { model: string; body: Record<string, unknown> }[] = [];
  const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ model: String(body.model), body });
    const next = queue.shift();
    if (!next) throw new Error('fake Groq queue is empty');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, requests };
}

export const fakeVerifier: TokenVerifier = {
  async verify(token) {
    if (token.startsWith('good-')) return { uid: token.slice(5), email: `${token.slice(5)}@example.com` };
    throw new Error('bad token');
  },
};
