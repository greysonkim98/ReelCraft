# ReelCraft

A web app that turns several phone videos into a vertical reel of up to 60 seconds (720×1280, 9:16 MP4) with AI-generated captions.

**Your videos never leave the browser.** Analysis, trimming, caption burn-in, and encoding all run in the browser with ffmpeg.wasm. The server only handles sign-in verification, usage limits, and the AI caption call. The UI is in English.

> **Current status:** sign-in (Firebase) → clips → style → analysis → AI captions (Groq) → review → render → share all work.
> **Not built yet:** SigLIP 2 scene tagging, Kokoro voice-over (TTS), per-step local saving, and the full failure-handling matrix.
> Deployment configs (Render, Firebase Hosting) exist as files, but nothing has been deployed.

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env        # then fill in the values
npm run dev:backend         # API on http://localhost:4000
npm run dev:frontend        # app on http://localhost:3000
```

Other scripts: `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run verify:render`.

More documentation:

- Running and checking locally: [docs/local-testing.md](docs/local-testing.md)
- Deployment, cost principles, and to-do list: [docs/launch-checklist.md](docs/launch-checklist.md)
- Component audit results: [docs/component-audit.md](docs/component-audit.md)

## Project structure

```
shared/    Shared types, zod schemas (scenes.json / script JSON), constants and limits
backend/   Express + Socket.IO. Calls Groq (gpt-oss-20b), verifies Firebase tokens, enforces daily usage limits
frontend/  Next.js (static export). lib/ffmpeg/ holds in-browser analysis and rendering; lib/auth, api, realtime
scripts/   verify-render.ts, browser-smoke.ts, audit/ (experiments and a static server)
firebase.json, firestore.rules, render.yaml
```

## Server API

| Route | Description |
| --- | --- |
| `GET /api/v1/health` | Health check (no sign-in required) |
| `GET /api/v1/me/usage` | AI caption uses left today |
| `POST /api/v1/ai/script` | scenes.json → script JSON. Requires sign-in. Limited to 3 calls per account per day and 60 per day overall |
| Socket.IO `project:progress` | Sends progress to the same account's other devices. Closes automatically after 2 minutes of inactivity or 15 minutes total |

## ffmpeg.wasm notes (measured, not assumed)

- **Always cap the thread count** ([threads.ts](frontend/lib/ffmpeg/threads.ts)). `@ffmpeg/core-mt` has a fixed pool of 32 workers, so leaving ffmpeg's default (one thread per core) makes the render hang at 0% forever.
- **Avoid filters that force an RGB conversion** ([filters.ts](frontend/lib/ffmpeg/filters.ts)). The YUV→RGB conversion leaks memory on every frame and the render dies from out-of-memory.
- If there are more than 20 input clips, the render automatically switches to the single-threaded core (slow mode).
- `@ffmpeg/core` is GPL-2.0-or-later (it includes x264/x265). This needs a notice page (`/licenses`) and a legal review.
