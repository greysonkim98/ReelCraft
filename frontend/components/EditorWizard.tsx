'use client';

import {
  COLOR_LOOKS,
  DEFAULT_LIMITS,
  NOTE_MAX_CHARS,
  SCENE_MAX_SECONDS,
  SUBTITLE_STYLES,
  TEMPOS,
  USER_MEMOS_MAX_COUNT,
  USER_PROMPT_MAX_CHARS,
  computeMaxChars,
  type ProgressStage,
  type Segment,
  type Style,
  type UsageInfo,
} from '@reelcraft/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, generateScript, getHealth, getUsage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { analyzeClips, type AnalyzeProgress } from '@/lib/ffmpeg/analyze';
import { RenderMemoryError, encodeVideo } from '@/lib/ffmpeg/encode';
import { CancelledError, cancelFFmpeg } from '@/lib/ffmpeg/loader';
import { computeFingerprint } from '@/lib/fingerprint';
import { readClipInfo } from '@/lib/media';
import { createProgressReporter, type ProgressReporter } from '@/lib/realtime';

interface ClipItem {
  id: string;
  file: File;
  duration: number;
  thumbnail?: string;
  fingerprint: string;
  note: string;
}

const LIMITS = DEFAULT_LIMITS;
const STEPS = ['Clips', 'Style', 'Analyze', 'Captions', 'Review', 'Render', 'Share'] as const;

const fmtBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const fmtSec = (n: number) => `${n.toFixed(1)}s`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtReset = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

const COLOR_SWATCH: Record<string, string> = {
  natural: 'from-slate-300 to-slate-500',
  warm: 'from-amber-300 to-orange-500',
  cool: 'from-sky-300 to-indigo-500',
  vivid: 'from-fuchsia-400 to-lime-400',
  film: 'from-stone-400 to-amber-800',
  mono: 'from-neutral-200 to-neutral-800',
};

function Card({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border-2 p-3 text-left text-sm transition ${
        selected ? 'border-slate-900 bg-white shadow' : 'border-slate-200 bg-white hover:border-slate-400'
      }`}
    >
      {children}
    </button>
  );
}

function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && <div className="mb-1 text-xs text-slate-600">{label}</div>}
      <div
        className="h-2.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-slate-900 transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

export function EditorWizard() {
  const { user, signOut, getToken } = useAuth();
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [style, setStyle] = useState<Style>({ color: 'natural', subtitle: 'classic', tempo: 'energetic', quality: '720p' });

  const [segments, setSegments] = useState<Segment[]>([]);
  const [unusedClips, setUnusedClips] = useState<number[]>([]);
  const [hasAudio, setHasAudio] = useState<boolean[]>([]);
  const [analysisNotes, setAnalysisNotes] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<{ running: boolean; progress?: AnalyzeProgress; error?: string }>({ running: false });

  const [userPrompt, setUserPrompt] = useState('');
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [ai, setAi] = useState<{ running: boolean; error?: string; done?: boolean; fallback?: boolean; model?: string | null }>({
    running: false,
  });
  const [render, setRender] = useState<{ running: boolean; fraction: number; eta?: number; error?: string; memory?: boolean; notice?: string }>({
    running: false,
    fraction: 0,
  });
  const [output, setOutput] = useState<{ url: string; blob: Blob } | null>(null);

  const [isolated, setIsolated] = useState<boolean | null>(null);
  const [serverState, setServerState] = useState<'checking' | 'waking' | 'up' | 'down'>('checking');
  const abortRef = useRef<AbortController | null>(null);
  const reporterRef = useRef<ProgressReporter | null>(null);

  useEffect(() => {
    setIsolated(window.crossOriginIsolated);
    // The free server sleeps when idle and takes up to a minute to wake: tell the user after 3 s.
    const timer = setTimeout(() => setServerState((s) => (s === 'checking' ? 'waking' : s)), 3000);
    getHealth()
      .then(() => setServerState('up'))
      .catch(() => setServerState('down'))
      .finally(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!user) return;
    void getToken()
      .then(getUsage)
      .then(setUsage)
      .catch(() => undefined);
  }, [user, getToken]);

  useEffect(() => {
    return () => {
      if (output) URL.revokeObjectURL(output.url);
    };
  }, [output]);

  useEffect(() => () => reporterRef.current?.close(), []);

  const goto = useCallback((n: number) => {
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
  }, []);

  const report = (stage: ProgressStage, percent: number, message?: string) => reporterRef.current?.report(stage, percent, message);

  const totalSize = clips.reduce((s, c) => s + c.file.size, 0);
  const limitBytes = LIMITS.maxTotalMB * 1024 * 1024;
  const totalSeconds = segments.reduce((s, x) => s + (x.end - x.start), 0);
  const overLimit = totalSeconds > LIMITS.maxOutputSeconds + 1e-6;

  // ---------- step 1: import ----------
  async function addFiles(list: File[]) {
    setImporting(true);
    const notes: string[] = [];
    const accepted: ClipItem[] = [];
    let used = totalSize;
    const known = new Set(clips.map((c) => c.fingerprint));
    const sorted = [...list].sort((a, b) => a.lastModified - b.lastModified);
    for (const file of sorted) {
      if (!file.type.startsWith('video/') && !/\.(mov|mp4|m4v|webm|mkv)$/i.test(file.name)) {
        notes.push(`${file.name}: not a video file.`);
        continue;
      }
      if (used + file.size > limitBytes) {
        notes.push(`${file.name}: not added, it would go over the ${LIMITS.maxTotalMB} MB total limit.`);
        continue;
      }
      try {
        const info = await readClipInfo(file);
        if (info.duration > LIMITS.maxClipSeconds) {
          notes.push(`${file.name}: longer than the ${LIMITS.maxClipSeconds / 60}-minute limit per clip (${fmtSec(info.duration)}).`);
          continue;
        }
        const fingerprint = await computeFingerprint(file);
        if (known.has(fingerprint)) {
          notes.push(`${file.name}: already added.`);
          continue;
        }
        known.add(fingerprint);
        used += file.size;
        accepted.push({ id: crypto.randomUUID(), file, duration: info.duration, thumbnail: info.thumbnail, fingerprint, note: '' });
      } catch (err) {
        notes.push(`${file.name}: ${(err as Error).message}`);
      }
    }
    if (accepted.length > 0) {
      setClips((prev) => [...prev, ...accepted]);
      resetAnalysis();
    }
    setMessages(notes);
    setImporting(false);
  }

  function resetAnalysis() {
    setSegments([]);
    setUnusedClips([]);
    setHasAudio([]);
    setAnalysisNotes([]);
    setOutput(null);
    setMaxStep((m) => Math.min(m, 3));
  }

  function moveClip(from: number, to: number) {
    if (to < 0 || to >= clips.length || from === to) return;
    setClips((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
    resetAnalysis();
  }

  const dragFrom = useRef<number | null>(null);

  // ---------- step 3: analysis ----------
  async function runAnalysis() {
    const controller = new AbortController();
    abortRef.current = controller;
    setAnalysis({ running: true });
    try {
      const result = await analyzeClips({
        files: clips.map((c) => c.file),
        durations: clips.map((c) => c.duration),
        tempo: style.tempo,
        maxOutputSeconds: LIMITS.maxOutputSeconds,
        signal: controller.signal,
        onProgress: (progress) => setAnalysis({ running: true, progress }),
      });
      setSegments(result.segments);
      setUnusedClips(result.unusedClips);
      setHasAudio(result.hasAudio);
      setAnalysisNotes(result.notes);
      setAnalysis({ running: false });
    } catch (err) {
      setAnalysis({ running: false, error: err instanceof CancelledError ? 'Analysis cancelled.' : (err as Error).message });
    }
  }

  // ---------- step 4: AI captions ----------
  const memos = clips
    .map((c) => c.note.trim())
    .filter(Boolean)
    .slice(0, USER_MEMOS_MAX_COUNT);
  const outOfUses = usage !== null && usage.remaining <= 0;

  async function runAi() {
    setAi({ running: true });
    try {
      const token = await getToken();
      const res = await generateScript(token, {
        scenes: segments.map((s) => {
          const start = round1(s.start);
          return {
            scene_id: s.id,
            start,
            end: Math.max(start + 0.1, round1(Math.min(s.end, s.start + SCENE_MAX_SECONDS))),
            mood: [],
            setting: [],
            people: false,
            hearted: false,
            score: Math.min(1, Math.max(0, s.score ?? 0)),
            max_chars: s.maxChars,
          };
        }),
        userPrompt: userPrompt.trim(),
        userMemos: memos,
      });
      const byId = new Map(res.script.scenes.map((l) => [l.scene_id, l.caption]));
      setSegments((prev) => prev.map((s) => ({ ...s, subtitle: byId.get(s.id) ?? s.subtitle, editedByUser: false })));
      setUsage(res.usage);
      reporterRef.current?.close();
      reporterRef.current = createProgressReporter({ projectId: res.projectId, getToken });
      setAi({ running: false, done: true, fallback: res.source === 'fallback', model: res.model });
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'DAILY_LIMIT') {
        const details = e.details as { usage?: UsageInfo } | undefined;
        if (details?.usage) setUsage({ ...details.usage, remaining: 0 });
      }
      setAi({ running: false, error: e.code === 'UNAUTHENTICATED' ? 'Your session expired. Go back to the home page and sign in again.' : e.message });
    }
  }

  // ---------- step 5: review ----------
  function patchSegment(id: string, patch: Partial<Segment>) {
    setSegments((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        next.maxChars = computeMaxChars(next.end - next.start);
        return next;
      }),
    );
    setOutput(null);
  }

  function moveSegment(i: number, to: number) {
    if (to < 0 || to >= segments.length) return;
    setSegments((prev) => {
      const next = [...prev];
      const [item] = next.splice(i, 1);
      next.splice(to, 0, item!);
      return next;
    });
    setOutput(null);
  }

  function addUnused(clipIndex: number) {
    const clip = clips[clipIndex];
    if (!clip) return;
    const end = round1(Math.min(clip.duration, 1.5));
    setSegments((prev) => [
      ...prev,
      {
        id: `m${Date.now()}`,
        clipIndex,
        start: 0,
        end,
        subtitle: '',
        maxChars: computeMaxChars(end),
        editedByUser: true,
      },
    ]);
    setUnusedClips((prev) => prev.filter((i) => i !== clipIndex));
  }

  // ---------- step 6: render ----------
  async function runRender() {
    const controller = new AbortController();
    abortRef.current = controller;
    setOutput(null);
    setRender({ running: true, fraction: 0 });
    report('rendering', 0);
    try {
      const blob = await encodeVideo({
        files: clips.map((c) => c.file),
        hasAudio,
        segments,
        style,
        signal: controller.signal,
        onNotice: (notice) => setRender((r) => ({ ...r, notice })),
        onProgress: ({ fraction, etaSeconds }) => {
          setRender((r) => ({ ...r, running: true, fraction, eta: etaSeconds }));
          report('rendering', fraction * 100);
        },
      });
      setOutput({ url: URL.createObjectURL(blob), blob });
      setRender({ running: false, fraction: 1 });
      report('done', 100);
      goto(7);
    } catch (err) {
      report('failed', 0);
      if (err instanceof CancelledError) setRender({ running: false, fraction: 0, error: 'Rendering cancelled.' });
      else if (err instanceof RenderMemoryError) setRender({ running: false, fraction: 0, error: err.message, memory: true });
      else setRender({ running: false, fraction: 0, error: (err as Error).message });
    }
  }

  function cancelJob() {
    abortRef.current?.abort();
    cancelFFmpeg();
  }

  // ---------- step 7: share ----------
  const fileName = `reelcraft-${new Date().toISOString().slice(0, 10)}.mp4`;
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    if (!output || typeof navigator.canShare !== 'function') return setCanShare(false);
    setCanShare(navigator.canShare({ files: [new File([output.blob], fileName, { type: 'video/mp4' })] }));
  }, [output, fileName]);

  async function share() {
    if (!output) return;
    try {
      await navigator.share({ files: [new File([output.blob], fileName, { type: 'video/mp4' })] });
    } catch {
      // user dismissed the share sheet
    }
  }

  // ---------- UI ----------
  const nextDisabled =
    (step === 1 && clips.length === 0) || (step === 3 && segments.length === 0) || (step === 5 && (overLimit || segments.length === 0));

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold">ReelCraft editor</h1>
          <div className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
            <span className="max-w-[10rem] truncate" title={user?.email ?? undefined}>
              {user?.email}
            </span>
            <button type="button" onClick={() => void signOut()} className="rounded bg-slate-200 px-2 py-1 font-medium text-slate-800">
              Sign out
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Your videos never leave this device. Analysis, editing and encoding all happen in your browser.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${isolated ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
            {isolated === null ? 'Checking…' : isolated ? 'Multi-thread ffmpeg' : 'Slow mode (single thread)'}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              serverState === 'up' ? 'bg-emerald-100 text-emerald-800' : serverState === 'down' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {serverState === 'up' && 'Server connected'}
            {serverState === 'checking' && 'Checking server…'}
            {serverState === 'waking' && 'Waking the server (up to a minute)…'}
            {serverState === 'down' && 'Server unreachable'}
          </span>
          {usage && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700" data-testid="usage">
              {usage.remaining} of {usage.limit} AI caption runs left today
            </span>
          )}
        </div>
      </header>

      <nav aria-label="Steps" className="mb-5 flex gap-1 overflow-x-auto pb-1">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const reachable = n <= maxStep;
          return (
            <button
              key={label}
              type="button"
              disabled={!reachable || render.running || analysis.running}
              onClick={() => setStep(n)}
              aria-current={step === n ? 'step' : undefined}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                step === n ? 'bg-slate-900 text-white' : reachable ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {n}. {label}
            </button>
          );
        })}
      </nav>

      {step === 1 && (
        <section aria-labelledby="s1" className="space-y-4">
          <h2 id="s1" className="text-lg font-semibold">Add your clips</h2>
          <div>
            <ProgressBar value={Math.min(1, totalSize / limitBytes)} label={`${fmtBytes(totalSize)} of ${LIMITS.maxTotalMB} MB`} />
          </div>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current === null) void addFiles([...e.dataTransfer.files]);
            }}
            className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600 hover:border-slate-500"
          >
            <span className="font-medium">{importing ? 'Reading…' : 'Choose videos or drop them here'}</span>
            <span className="text-xs">Up to {LIMITS.maxClipSeconds / 60} minutes per clip</span>
            <input
              type="file"
              accept="video/*"
              multiple
              className="sr-only"
              disabled={importing}
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </label>
          {messages.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-rose-50 p-3 text-xs text-rose-800" role="alert">
              {messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <ol className="space-y-2">
            {clips.map((c, i) => (
              <li
                key={c.id}
                draggable
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragFrom.current !== null) moveClip(dragFrom.current, i);
                  dragFrom.current = null;
                }}
                onDragEnd={() => (dragFrom.current = null)}
                className="flex gap-3 rounded-xl bg-white p-3 shadow-sm"
              >
                {c.thumbnail ? (
                  <img src={c.thumbnail} alt="" className="h-20 w-14 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-20 w-14 shrink-0 rounded bg-slate-200" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-sm font-medium">
                    {i + 1}. {c.file.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmtSec(c.duration)} · {fmtBytes(c.file.size)}
                  </div>
                  <input
                    value={c.note}
                    maxLength={NOTE_MAX_CHARS}
                    aria-label={`${c.file.name} note`}
                    placeholder="Where were you, how did it feel? e.g. Santa Cruz, waves and golden light"
                    onChange={(e) => setClips((prev) => prev.map((x) => (x.id === c.id ? { ...x, note: e.target.value } : x)))}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <button type="button" aria-label="Move up" onClick={() => moveClip(i, i - 1)} className="rounded bg-slate-100 px-2 text-xs">
                    ↑
                  </button>
                  <button type="button" aria-label="Move down" onClick={() => moveClip(i, i + 1)} className="rounded bg-slate-100 px-2 text-xs">
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => {
                      setClips((prev) => prev.filter((x) => x.id !== c.id));
                      resetAnalysis();
                    }}
                    className="rounded bg-rose-100 px-2 text-xs text-rose-700"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="s2" className="space-y-5">
          <h2 id="s2" className="text-lg font-semibold">Pick a style</h2>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Color look</legend>
            <div className="grid grid-cols-3 gap-2">
              {COLOR_LOOKS.map((c) => (
                <Card key={c} selected={style.color === c} onClick={() => setStyle({ ...style, color: c })}>
                  <div className={`mb-2 h-10 rounded bg-gradient-to-br ${COLOR_SWATCH[c]}`} />
                  <span className="capitalize">{c}</span>
                </Card>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Caption style</legend>
            <div className="grid grid-cols-2 gap-2">
              {SUBTITLE_STYLES.map((s) => (
                <Card key={s} selected={style.subtitle === s} onClick={() => setStyle({ ...style, subtitle: s })}>
                  <div className="mb-2 flex h-12 items-end justify-center rounded bg-slate-700 pb-1">
                    <span
                      className={
                        s === 'classic'
                          ? 'text-sm font-bold text-white [text-shadow:0_0_3px_#000,0_0_3px_#000]'
                          : s === 'box'
                            ? 'bg-black/60 px-1 text-sm font-bold text-white'
                            : s === 'pop'
                              ? 'text-base font-extrabold text-yellow-300 [text-shadow:0_0_4px_#000,0_0_4px_#000]'
                              : 'text-xs font-bold text-white [text-shadow:1px_2px_2px_#000]'
                      }
                    >
                      Salt air, zero plans
                    </span>
                  </div>
                  <span className="capitalize">{s}</span>
                </Card>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Editing pace</legend>
            <div className="grid grid-cols-2 gap-2">
              {TEMPOS.map((t) => (
                <Card key={t} selected={style.tempo === t} onClick={() => setStyle({ ...style, tempo: t })}>
                  <div className="font-medium capitalize">{t}</div>
                  <div className="text-xs text-slate-500">{t === 'energetic' ? '1–2 second cuts, fast' : '3–5 second cuts, relaxed'}</div>
                </Card>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-slate-500">The video is exported as 720×1280 (9:16), the Instagram Reels format.</p>
        </section>
      )}

      {step === 3 && (
        <section aria-labelledby="s3" className="space-y-4">
          <h2 id="s3" className="text-lg font-semibold">Find the best scenes</h2>
          <p className="text-sm text-slate-600">
            Analyzes {clips.length} clip{clips.length === 1 ? '' : 's'} in your browser and drafts {style.tempo === 'energetic' ? '1–2' : '3–5'} second cuts.
          </p>
          {analysis.running ? (
            <div className="space-y-3">
              <ProgressBar
                value={analysis.progress?.overall ?? 0}
                label={
                  analysis.progress
                    ? `${Math.round(analysis.progress.overall * 100)}% · clip ${analysis.progress.clipIndex + 1}/${clips.length} (${
                        analysis.progress.stage === 'proxy' ? 'making preview' : 'checking quality'
                      })`
                    : 'Loading ffmpeg…'
                }
              />
              <button type="button" onClick={cancelJob} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white">
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={clips.length === 0}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {segments.length > 0 ? 'Analyze again' : 'Start analysis'}
            </button>
          )}
          {analysis.error && (
            <p role="alert" data-testid="analysis-error" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
              {analysis.error}
            </p>
          )}
          {analysisNotes.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              {analysisNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {segments.length > 0 && (
            <div className="rounded-lg bg-white p-3 text-sm shadow-sm" data-testid="analysis-summary">
              {segments.length} scene{segments.length === 1 ? '' : 's'} · {fmtSec(totalSeconds)} total
              {unusedClips.length > 0 && <span className="text-slate-500"> · unused clips: {unusedClips.map((i) => i + 1).join(', ')}</span>}
            </div>
          )}
        </section>
      )}

      {step === 4 && (
        <section aria-labelledby="s4" className="space-y-4">
          <h2 id="s4" className="text-lg font-semibold">AI captions</h2>
          <p className="text-sm text-slate-600">
            Describe the reel you want. Only this sentence, your clip notes and each scene&apos;s length are sent to the AI. Your video is not.
          </p>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">What kind of reel is this?</span>
            <input
              value={userPrompt}
              maxLength={USER_PROMPT_MAX_CHARS}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="e.g. relaxing weekend trip with friends"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-slate-500">
            {memos.length > 0 ? `Using ${memos.length} clip note${memos.length === 1 ? '' : 's'}: names of places and people come only from your notes.` : 'No clip notes yet. Add notes in step 1 to get captions that mention real places.'}
          </p>
          {usage && (
            <p className="text-xs text-slate-500">
              {outOfUses
                ? `You have used all ${usage.limit} AI runs for today. They reset at ${fmtReset(usage.resetAt)}. You can still write captions yourself.`
                : `${usage.remaining} of ${usage.limit} AI runs left today.`}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runAi()}
              disabled={ai.running || segments.length === 0 || userPrompt.trim() === '' || outOfUses}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {ai.running ? 'Writing captions…' : segments.some((s) => s.subtitle) ? 'Write them again' : 'Write captions with AI'}
            </button>
            <button type="button" onClick={() => goto(5)} className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold">
              Write captions myself
            </button>
          </div>
          {ai.error && (
            <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
              {ai.error}
            </p>
          )}
          {ai.done && !ai.fallback && (
            <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="ai-done">
              Done. Review and edit the captions in the next step.
            </p>
          )}
          {ai.done && ai.fallback && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="ai-fallback">
              The AI was busy, so these captions are built from your notes. You can edit them in the next step, and this did not use up a run.
            </p>
          )}
          <ol className="space-y-1 text-sm">
            {segments.map((s, i) => (
              <li key={s.id} className="rounded bg-white px-3 py-2 shadow-sm">
                <span className="text-xs text-slate-400">{i + 1}.</span> {s.subtitle || <span className="text-slate-400">(empty)</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {step === 5 && (
        <section aria-labelledby="s5" className="space-y-4">
          <h2 id="s5" className="text-lg font-semibold">Review and edit</h2>
          <div className={`rounded-lg p-3 text-sm ${overLimit ? 'bg-rose-50 text-rose-800' : 'bg-white shadow-sm'}`} role={overLimit ? 'alert' : undefined}>
            Total length {fmtSec(totalSeconds)} of {LIMITS.maxOutputSeconds}s
            {overLimit && ' — too long to render. Shorten some scenes.'}
          </div>
          <ol className="space-y-3">
            {segments.map((s, i) => (
              <li key={s.id} className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {i + 1}. Clip {s.clipIndex + 1} · {clips[s.clipIndex]?.file.name}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" aria-label="Move up" onClick={() => moveSegment(i, i - 1)} className="rounded bg-slate-100 px-2">
                      ↑
                    </button>
                    <button type="button" aria-label="Move down" onClick={() => moveSegment(i, i + 1)} className="rounded bg-slate-100 px-2">
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => {
                        setSegments((prev) => prev.filter((x) => x.id !== s.id));
                        setUnusedClips((prev) =>
                          segments.some((x) => x.id !== s.id && x.clipIndex === s.clipIndex) ? prev : [...prev, s.clipIndex].sort(),
                        );
                      }}
                      className="rounded bg-rose-100 px-2 text-rose-700"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">
                    Start
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={Math.max(0, s.end - 0.5)}
                      value={s.start}
                      onChange={(e) => patchSegment(s.id, { start: Math.max(0, Number(e.target.value)) })}
                      className="w-16 rounded border border-slate-300 px-1 py-0.5"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    End
                    <input
                      type="number"
                      step={0.1}
                      min={s.start + 0.5}
                      max={clips[s.clipIndex]?.duration}
                      value={s.end}
                      onChange={(e) =>
                        patchSegment(s.id, { end: Math.min(clips[s.clipIndex]?.duration ?? Infinity, Number(e.target.value)) })
                      }
                      className="w-16 rounded border border-slate-300 px-1 py-0.5"
                    />
                  </label>
                  <span className="text-slate-500">{fmtSec(s.end - s.start)}</span>
                </div>
                <div>
                  <textarea
                    rows={2}
                    value={s.subtitle}
                    maxLength={s.maxChars}
                    aria-label={`Scene ${i + 1} caption`}
                    onChange={(e) => patchSegment(s.id, { subtitle: e.target.value, editedByUser: true })}
                    className="w-full resize-none rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <div className={`text-right text-xs ${s.subtitle.length >= s.maxChars ? 'text-amber-700' : 'text-slate-400'}`}>
                    {s.subtitle.length}/{s.maxChars}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {unusedClips.length > 0 && (
            <div className="space-y-2 rounded-xl bg-white p-3 text-sm shadow-sm">
              <div className="font-medium">Unused clips</div>
              {unusedClips.map((i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate">
                    {i + 1}. {clips[i]?.file.name}
                  </span>
                  <button type="button" onClick={() => addUnused(i)} className="rounded bg-slate-900 px-2 py-1 text-white">
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 6 && (
        <section aria-labelledby="s6" className="space-y-4">
          <h2 id="s6" className="text-lg font-semibold">Render</h2>
          <p className="text-sm text-slate-600">
            Encodes a {style.quality} vertical video from your original clips. Rendering uses no AI, so you can redo it as often as you like.
          </p>
          {render.running ? (
            <div className="space-y-3">
              <ProgressBar
                value={render.fraction}
                label={`${Math.round(render.fraction * 100)}%${render.eta !== undefined ? ` · about ${Math.ceil(render.eta)}s left` : ''}`}
              />
              <button type="button" onClick={cancelJob} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white">
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void runRender()}
              disabled={overLimit || segments.length === 0}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Start rendering
            </button>
          )}
          {render.notice && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{render.notice}</p>}
          {render.error && (
            <div role="alert" data-testid="render-error" className="space-y-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
              <p>{render.error}</p>
              {render.memory && <p className="text-xs">Try fewer or shorter scenes, or close other tabs and apps, then render again.</p>}
            </div>
          )}
        </section>
      )}

      {step === 7 && (
        <section aria-labelledby="s7" className="space-y-4">
          <h2 id="s7" className="text-lg font-semibold">Share or download</h2>
          {output ? (
            <>
              <video src={output.url} controls playsInline className="mx-auto max-h-[70vh] rounded-xl bg-black" />
              <div className="text-xs text-slate-500">{fmtBytes(output.blob.size)}</div>
              {canShare ? (
                <button type="button" onClick={() => void share()} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white">
                  Share to Instagram
                </button>
              ) : (
                <a
                  href={output.url}
                  download={fileName}
                  className="block w-full rounded-xl bg-slate-900 px-4 py-3 text-center font-semibold text-white"
                >
                  Download ({fileName})
                </a>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-600">Nothing has been rendered yet.</p>
          )}
          <button type="button" onClick={() => setStep(5)} className="w-full rounded-xl bg-slate-200 px-4 py-3 text-sm font-semibold">
            Back to editing
          </button>
        </section>
      )}

      <footer className="mt-10 flex flex-wrap gap-4 text-xs text-slate-500">
        <a href="/terms" className="underline">Terms</a>
        <a href="/privacy" className="underline">Privacy</a>
        <a href="/licenses" className="underline">Open-source licenses</a>
      </footer>

      {step < 7 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-xl gap-2">
            <button
              type="button"
              disabled={step === 1 || analysis.running || render.running}
              onClick={() => setStep(step - 1)}
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              disabled={nextDisabled || analysis.running || render.running || ai.running}
              onClick={() => goto(step + 1)}
              className="flex-1 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
