import { describe, expect, it, vi } from 'vitest';
import { createMusicService } from '../src/services/music';
import { musicPreferenceSchema, projectPatchSchema } from '@reelcraft/shared';
const json = (data: unknown) => new Response(JSON.stringify(data));
describe('music', () => {
  it('searches semantically with private authorization and anonymous user attribution', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        tracks: [{ id: 'track', title: 'Calm', mainArtists: ['Artist'], isPreviewOnly: false }],
      }),
    );
    const result = await createMusicService('private', fetcher).search('user', 'calm beach');
    expect(result.tracks[0]?.id).toBe('track');
    expect(fetcher.mock.calls[0]?.[0]).toContain('term=calm+beach');
    const headers = fetcher.mock.calls[0]?.[1].headers;
    expect(headers.Authorization).toBe('Bearer private');
    expect(headers['x-partner-user-id']).not.toBe('user');
  });
  it('only returns explicitly available tracks, excluding premium and unknown access', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        tracks: [
          { id: 'free', title: 'Available', mainArtists: [], isPreviewOnly: false },
          { id: 'premium', title: 'Restricted', mainArtists: [], isPreviewOnly: true },
          { id: 'unknown', title: 'Unknown access', mainArtists: [] },
        ],
      }),
    );
    const result = await createMusicService('key', fetcher).search('u', 'music');
    expect(result.tracks.map((t) => t.id)).toEqual(['free']);
  });
  it('looks beyond a full page of preview-only tracks for available music', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          tracks: Array.from({ length: 60 }, (_, i) => ({
            id: String(i),
            title: 'Preview',
            mainArtists: [],
            isPreviewOnly: true,
          })),
        }),
      )
      .mockResolvedValueOnce(
        json({
          tracks: [{ id: 'available', title: 'Available', mainArtists: [], isPreviewOnly: false }],
        }),
      );
    expect((await createMusicService('key', fetcher).search('u', 'music')).tracks[0]?.id).toBe(
      'available',
    );
    expect(fetcher.mock.calls[1]?.[0]).toContain('offset=60');
  });
  it('returns an empty list when there are no available tracks', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        tracks: [{ id: 'premium', title: 'Restricted', mainArtists: [], isPreviewOnly: true }],
      }),
    );
    fetcher
      .mockResolvedValueOnce(
        json({
          tracks: [{ id: 'premium', title: 'Restricted', mainArtists: [], isPreviewOnly: true }],
        }),
      )
      .mockResolvedValueOnce(json({ collections: [] }));
    expect((await createMusicService('key', fetcher).search('u', 'music')).tracks).toEqual([]);
  });
  it('finds free tracks in collection details when search and collection summaries incorrectly say preview-only', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/tracks/search'))
        return json({
          tracks: [{ id: 'restricted', title: 'Preview', mainArtists: [], isPreviewOnly: true }],
        });
      if (url.includes('/collections?'))
        return json({
          collections: [
            {
              id: 'collection',
              name: 'Viral Reels',
              tracks: [{ id: 'free', isPreviewOnly: true }],
            },
          ],
        });
      return json({
        tracks: [
          {
            id: 'calm',
            title: 'Quiet',
            mainArtists: [],
            isPreviewOnly: false,
            moods: [{ name: 'Calm' }],
          },
          {
            id: 'free',
            title: 'Action',
            mainArtists: [],
            isPreviewOnly: false,
            moods: [{ name: 'Energetic' }],
            hasVocals: false,
          },
          { id: 'restricted', title: 'Premium', mainArtists: [], isPreviewOnly: true },
        ],
      });
    });
    const service = createMusicService('key', fetcher);
    const result = await service.search('u', 'energetic instrumental');
    expect(result.collectionFallback).toBe(true);
    expect(result.tracks.map((t) => t.id)).toEqual(['free', 'calm']);
    await service.search('u', 'calm');
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/collections?')),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/collections/collection?')),
    ).toHaveLength(1);
    // Fallback only fetches metadata; it must never consume a download or preview.
    expect(fetcher.mock.calls.some(([url]) => /\/(download|stream)/.test(String(url)))).toBe(false);
  });
  it("does not reuse another user's collection access", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async (url: string) =>
        url.includes('/tracks/search') ? json({ tracks: [] }) : json({ collections: [] }),
      );
    const service = createMusicService('key', fetcher);
    await service.search('alice', 'calm');
    await service.search('bob', 'calm');
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes('/collections?')),
    ).toHaveLength(2);
  });
  it('uses preview endpoint without consuming downloads', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json({ url: 'https://example.com/a.m3u8', expires: '2030-01-01' }));
    await createMusicService('key', fetcher).preview('user', 'track');
    expect(fetcher.mock.calls[0]?.[0]).toContain('/track/stream');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('caches permitted downloads until expiration and reports only exports', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json([{ id: 'track', title: 'Song', mainArtists: [], isPreviewOnly: false }]),
      )
      .mockResolvedValueOnce(json({ url: 'https://example.com/a.mp3', expires: '2030-01-01' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const service = createMusicService('key', fetcher);
    await service.download('user', 'track');
    await service.download('user', 'track');
    expect(fetcher).toHaveBeenCalledTimes(2);
    await service.exported('user', 'track');
    expect(JSON.parse(fetcher.mock.calls[2]?.[1].body)).toEqual({
      eventType: 'EXPORTED',
      platform: 'LOCAL',
      trackIds: ['track'],
    });
  });
  it('rejects preview-only tracks before download', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        json([{ id: 'track', title: 'Song', mainArtists: [], isPreviewOnly: true }]),
      );
    await expect(
      createMusicService('key', fetcher).download('user', 'track'),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('handles missing credentials, upstream failures and rate limits without leaking details', async () => {
    await expect(createMusicService().search('u', 'calm')).rejects.toMatchObject({ status: 503 });
    for (const status of [403, 429, 500]) {
      await expect(
        createMusicService(
          'secret',
          vi.fn().mockResolvedValue(new Response('secret', { status })),
        ).search('u', 'calm'),
      ).rejects.toMatchObject({ code: 'MUSIC_UNAVAILABLE' });
    }
  });
  it('accepts selection, change, volume and complete removal while rejecting invalid settings', () => {
    for (const trackId of ['first', 'second', null])
      expect(
        projectPatchSchema.parse({ music: { enabled: trackId !== null, trackId, volume: 0.2 } })
          .music?.trackId,
      ).toBe(trackId);
    expect(
      musicPreferenceSchema.safeParse({ enabled: true, trackId: 'x', volume: 2 }).success,
    ).toBe(false);
  });
});
