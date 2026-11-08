'use client';
import { useEffect, useRef, useState } from 'react';
import type { MusicPreference, MusicTrack } from '@reelcraft/shared';
import { musicLink, searchMusic } from '@/lib/api';

function TrackPreview({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const audio = ref.current!;
    let disposed = false;
    let cleanup = () => {};
    setError('');
    if (audio.canPlayType('application/vnd.apple.mpegurl')) audio.src = url;
    else
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (disposed) return;
          if (!Hls.isSupported()) {
            setError('Music preview is unavailable in this browser.');
            return;
          }
          const hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(audio);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) setError('Preview expired or unavailable. Click Preview to retry.');
          });
          cleanup = () => hls.destroy();
        })
        .catch(() => setError('Could not load music preview.'));
    return () => {
      disposed = true;
      cleanup();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [url]);
  return (
    <>
      <audio
        ref={ref}
        crossOrigin="anonymous"
        controls
        onError={() => setError('Preview unavailable. Please retry.')}
        aria-label="Track preview"
      />
      {error && <p role="status">{error}</p>}
    </>
  );
}

export function MusicControls({
  value,
  onChange,
  description,
  getToken,
  disabled,
}: {
  value: MusicPreference;
  onChange: (value: MusicPreference) => void;
  description: string;
  getToken: () => Promise<string>;
  disabled: boolean;
}) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [collectionFallback, setCollectionFallback] = useState(false);
  const [term, setTerm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string>();
  const request = useRef(0);
  const recommendationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const preference = useRef(value);
  preference.current = value;
  const [pickNotice, setPickNotice] = useState('');
  async function search(query: string, pickForVideo = false) {
    clearTimeout(recommendationTimer.current);
    const version = ++request.current;
    setBusy(true);
    setError('');
    setPickNotice('');
    try {
      const result = await searchMusic(await getToken(), query);
      if (version === request.current) {
        setTracks(result.tracks);
        setCollectionFallback(result.collectionFallback ?? false);
        if (pickForVideo) {
          // The provider returns results in relevance order for the existing video description.
          const bestMatch = result.tracks.find((track) => !track.isPreviewOnly);
          if (bestMatch) {
            setPreview(undefined);
            onChange({ ...preference.current, enabled: true, trackId: bestMatch.id });
            setPickNotice(
              `Picked "${bestMatch.title}" based on your video. Preview it below or choose another track.`,
            );
          } else {
            setPickNotice(
              'No available match was found for this video. Your current selection has not changed.',
            );
          }
        }
      }
    } catch (e) {
      if (version === request.current) setError((e as Error).message);
    } finally {
      if (version === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    recommendationTimer.current = value.enabled
      ? setTimeout(() => void search(description), 400)
      : undefined;
    if (!value.enabled) {
      request.current++;
      setBusy(false);
      setPreview(undefined);
      setPickNotice('');
    }
    return () => {
      clearTimeout(recommendationTimer.current);
      request.current++;
    };
    // Recommendations only run when enabled or when the analyzed description changes.
  }, [value.enabled, description]);
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Background music</h2>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        Add background music
      </label>
      {value.enabled && (
        <>
          <p className="text-xs text-slate-600">
            Recommendations use your existing video analysis and captions. Music remains editable
            until download. Only music available to use with the current account is shown.
          </p>
          <p className="text-xs text-slate-500">{description}</p>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void search(description, true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Pick music for me
          </button>
          {pickNotice && (
            <p role="status" className="text-sm text-slate-600">
              {pickNotice}
            </p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search(term.trim() || description);
            }}
          >
            <input
              aria-label="Search music"
              className="min-w-0 flex-1 rounded border p-2"
              value={term}
              maxLength={1000}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Describe different music"
              disabled={disabled}
            />
            <button disabled={disabled || busy} className="rounded bg-slate-900 px-3 text-white">
              Search
            </button>
          </form>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void search(description)}
          >
            Refresh recommendations
          </button>
          {busy && <p role="status">Finding music...</p>}
          {!busy && collectionFallback && (
            <p className="text-xs text-slate-600">
              Showing available songs from your included collections, ranked against your video or
              search description.
            </p>
          )}
          {error && (
            <p role="status" className="text-sm text-amber-800">
              {error} You can turn music off and continue.
            </p>
          )}
          {!busy && !error && tracks.length === 0 && (
            <p>
              No available tracks found for this search. Try another description. If no tracks
              appear, the current Epidemic Sound API account may not include downloadable music.
            </p>
          )}
          {tracks
            .filter((track) => !track.isPreviewOnly)
            .map((track) => (
              <div
                key={track.id}
                className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm"
              >
                <span className="flex-1">
                  {track.title} - {track.mainArtists.join(', ')}
                  {track.isPreviewOnly && ' (preview only)'}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={async () => {
                    try {
                      setPreview((await musicLink(await getToken(), track.id, 'preview')).url);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Preview
                </button>
                <button
                  type="button"
                  disabled={disabled || track.isPreviewOnly}
                  aria-pressed={value.trackId === track.id}
                  onClick={() => onChange({ ...value, trackId: track.id })}
                >
                  {value.trackId === track.id ? 'Selected' : 'Select'}
                </button>
              </div>
            ))}
          {preview && <TrackPreview url={preview} />}
          {value.trackId && (
            <p className="text-xs">
              Selected track: {tracks.find((t) => t.id === value.trackId)?.title ?? value.trackId}
            </p>
          )}
          <label className="block text-sm">
            Music volume: {Math.round(value.volume * 100)}%
            <input
              aria-label="Music volume"
              type="range"
              className="block w-full"
              min="0"
              max="1"
              step="0.01"
              value={value.volume}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
            />
          </label>
          <p className="text-xs text-slate-500">
            Music is lowered further during narration. Available tracks depend on ReelCraft?s
            Epidemic Sound license.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, enabled: false, trackId: null })}
          >
            Remove music
          </button>
        </>
      )}
    </section>
  );
}
