import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../lib/errors';

const track = z.object({
  id: z.string(),
  title: z.string(),
  mainArtists: z.array(z.string()),
  isPreviewOnly: z.boolean().default(true),
});
const tag = z.union([
  z.string(),
  z.object({ id: z.string().optional(), name: z.string().optional() }),
]);
const collectionTrack = track.extend({
  moods: z.array(tag).default([]),
  genres: z.array(tag).default([]),
  hasVocals: z.boolean().optional(),
});
type CollectionTrack = z.infer<typeof collectionTrack> & { collectionName: string };
const link = z.object({ url: z.string().url(), expires: z.string() });
export function createMusicService(key?: string, fetchFn: typeof fetch = fetch) {
  const collectionCache = new Map<string, { expires: number; tracks: CollectionTrack[] }>();
  const collectionPending = new Map<string, Promise<CollectionTrack[]>>();
  const downloads = new Map<string, { url: string; expires: string }>();
  const pending = new Map<string, Promise<{ url: string; expires: string }>>();
  async function call(uid: string, path: string, body?: unknown): Promise<unknown> {
    if (!key)
      throw new AppError(
        503,
        'MUSIC_UNAVAILABLE',
        'Music is not configured. You can continue without music.',
      );
    try {
      const response = await fetchFn(`https://api.epidemicsound.com/v0${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'x-partner-user-id': createHash('sha256').update(uid).digest('hex'),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new AppError(
          response.status === 429 ? 429 : response.status === 403 ? 403 : 502,
          'MUSIC_UNAVAILABLE',
          response.status === 403
            ? 'This track is not available under the current music license. Choose another track.'
            : 'Music service is temporarily unavailable. Retry or continue without music.',
        );
      return response.status === 204 ? undefined : await response.json();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        'MUSIC_UNAVAILABLE',
        'Music service could not be reached. Retry or continue without music.',
      );
    }
  }
  async function includedTracks(uid: string): Promise<CollectionTrack[]> {
    const cached = collectionCache.get(uid);
    if (cached && cached.expires > Date.now()) return cached.tracks;
    const existing = collectionPending.get(uid);
    if (existing) return existing;
    const load = (async () => {
      const available = new Map<string, CollectionTrack>();
      // Collection summaries/search can incorrectly mark included tracks preview-only.
      // Fetch collection details, whose track flags reflect the configured free tier.
      for (let offset = 0; offset < 100; offset += 20) {
        const page = z
          .object({ collections: z.array(z.object({ id: z.string(), name: z.string() })) })
          .parse(await call(uid, `/collections?limit=20&offset=${offset}`));
        for (let start = 0; start < page.collections.length; start += 4) {
          const details = await Promise.all(
            page.collections.slice(start, start + 4).map(async (collection) => {
              const detail = z
                .object({ tracks: z.array(collectionTrack) })
                .parse(
                  await call(uid, `/collections/${encodeURIComponent(collection.id)}?limit=100`),
                );
              return detail.tracks.map((t) => ({ ...t, collectionName: collection.name }));
            }),
          );
          for (const t of details.flat())
            if (!t.isPreviewOnly && !available.has(t.id)) available.set(t.id, t);
        }
        // A page containing available music is enough for useful suggestions. Avoid
        // scanning the full catalog on every request when search has no eligible match.
        if (available.size || page.collections.length < 20) break;
      }
      const tracks = [...available.values()];
      for (const [key, value] of collectionCache)
        if (value.expires <= Date.now()) collectionCache.delete(key);
      if (collectionCache.size >= 100) collectionCache.delete(collectionCache.keys().next().value!);
      if (tracks.length) collectionCache.set(uid, { tracks, expires: Date.now() + 5 * 60 * 1000 });
      return tracks;
    })();
    collectionPending.set(uid, load);
    try {
      return await load;
    } finally {
      collectionPending.delete(uid);
    }
  }
  return {
    async search(uid: string, term: string) {
      // Search covers the entire catalog; only explicitly downloadable tracks belong in
      // this editor. Missing eligibility flags are treated as preview-only by the schema.
      const available: z.infer<typeof track>[] = [];
      const seen = new Set<string>();
      for (let offset = 0; offset < 180 && available.length < 12; offset += 60) {
        const page = z
          .object({ tracks: z.array(track) })
          .parse(
            await call(
              uid,
              `/tracks/search?${new URLSearchParams({ term, limit: '60', offset: String(offset) })}`,
            ),
          );
        for (const result of page.tracks) {
          if (!result.isPreviewOnly && !seen.has(result.id)) {
            seen.add(result.id);
            available.push(result);
          }
        }
        if (page.tracks.length < 60) break;
      }
      if (available.length) return { tracks: available.slice(0, 12), collectionFallback: false };
      const tokens = new Set(term.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
      const candidates = [...(await includedTracks(uid))];
      const score = (candidate: CollectionTrack) => {
        const tags = [...candidate.moods, ...candidate.genres]
          .map((t) => (typeof t === 'string' ? t : `${t.id ?? ''} ${t.name ?? ''}`))
          .join(' ');
        const words = new Set(
          `${candidate.title} ${candidate.mainArtists.join(' ')} ${candidate.collectionName} ${tags}`
            .toLowerCase()
            .match(/[a-z0-9]{3,}/g) ?? [],
        );
        return (
          [...tokens].reduce((sum, word) => sum + (words.has(word) ? 1 : 0), 0) +
          (tokens.has('instrumental') && candidate.hasVocals === false ? 1 : 0)
        );
      };
      candidates.sort((a, b) => score(b) - score(a));
      return {
        tracks: candidates.slice(0, 12).map(({ id, title, mainArtists, isPreviewOnly }) => ({
          id,
          title,
          mainArtists,
          isPreviewOnly,
        })),
        collectionFallback: candidates.length > 0,
      };
    },
    async preview(uid: string, id: string) {
      return link.parse(await call(uid, `/tracks/${id}/stream`));
    },
    async download(uid: string, id: string) {
      const cacheKey = `${uid}:${id}`;
      const cached = downloads.get(cacheKey);
      if (cached && Date.parse(cached.expires) > Date.now() + 60000) return cached;
      if (pending.has(cacheKey)) return pending.get(cacheKey)!;
      const request = (async () => {
        const metadata = z
          .array(track)
          .parse(await call(uid, `/tracks/metadata?trackId=${encodeURIComponent(id)}`))
          .find((t) => t.id === id);
        if (!metadata)
          throw new AppError(
            404,
            'MUSIC_NOT_FOUND',
            'Track no longer available. Choose another track.',
          );
        if (metadata.isPreviewOnly)
          throw new AppError(
            403,
            'MUSIC_LICENSE',
            'This track is preview only. Select an available track.',
          );
        const result = link.parse(
          await call(uid, `/tracks/${id}/download?format=mp3&quality=normal`),
        );
        for (const [k, value] of downloads)
          if (Date.parse(value.expires) <= Date.now()) downloads.delete(k);
        if (downloads.size >= 1000) downloads.delete(downloads.keys().next().value!);
        downloads.set(cacheKey, result);
        return result;
      })();
      pending.set(cacheKey, request);
      try {
        return await request;
      } finally {
        pending.delete(cacheKey);
      }
    },
    async exported(uid: string, id: string) {
      await call(uid, '/usage', { eventType: 'EXPORTED', platform: 'LOCAL', trackIds: [id] });
    },
  };
}
export type MusicService = ReturnType<typeof createMusicService>;
