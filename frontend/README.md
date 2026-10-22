# ReelCraft frontend

Run `npm.cmd run dev:frontend` from the repository root, then visit `http://localhost:3000`.

## Pages

| Route                                | Screen                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `/`                                  | Public introduction                                                                                |
| `/login`                             | Google and email/password sign-in; optional Auth emulator                                          |
| `/projects`                          | Project collection with search, filters, sorting, grid/list layouts, rename, duplicate, and delete |
| `/projects/details?id=alpine-escape` | Sample project details and the planned restore workflow                                            |
| `/styles`                            | Interactive color, caption, and tempo previews; selections carry into a new editor session         |
| `/editor`, `/editor/clips`           | Clip import                                                                                        |
| `/editor/style`                      | Color, caption style, and pace                                                                     |
| `/editor/analyze`                    | Existing local scene analysis                                                                      |
| `/editor/captions`                   | Existing AI caption generation and manual caption entry                                            |
| `/editor/review`                     | Existing trimming, reordering, and caption editing                                                 |
| `/editor/render`                     | Existing 720p local rendering                                                                      |
| `/editor/share`                      | Finished video, native sharing, and download                                                       |
| `/account`                           | Google connection status and local profile preview                                                 |
| `/usage`                             | Live allowance from the existing usage endpoint after sign-in                                      |
| `/help`                              | Getting started and current feature availability                                                   |
| `/admin`                             | Live account counts and seven-day AI usage                                                         |
| `/admin/users`                       | Live account search, usage, roles, suspensions, deactivation and restoration                       |
| `/admin/ips`                         | Live network activity, account membership, and audited temporary blocks                            |
| `/admin/settings`                    | Persistent, enforced runtime limits                                                                |
| `/admin/audit`                       | Persistent audit log with actor, reason and before/after changes                                   |
| `/terms`, `/privacy`, `/licenses`    | Existing legal content in the shared visual style                                                  |

## Scope and state

The management console uses authenticated backend APIs and Firestore. See [admin management](../docs/admin-management.md) for permissions, persistence, and enforcement details. Some creator-facing pages below still use labeled preview data.

- Project cards are **sample records**, not saved edits. Their metadata changes persist in browser localStorage under `reelcraft:ui-preview-projects:v1`. No selected video files or real editor plans are persisted by this collection.
- The account name form is a labeled browser-only preview. It does not modify the authenticated profile.
- Admin and support views use the stored account role and real API data. Management mutations require a reason and are audited atomically. Support cannot modify roles, runtime limits, network blocks, or audit history.
- Editor routes share a mounted layout so clip files, style choices, and edit state survive step navigation and browser Back/Forward. Directly opening a later step without clips shows a start-over notice. Leaving or refreshing the editor does not restore the edit; the browser warns when clips are present.
- Entry and exit links for `/editor` use full document navigation to preserve its existing COOP/COEP isolation. Only navigation between editor steps uses the Next router.
- **Preview the editor** permits local clip editing without an account. AI generation still requires sign-in and the existing authenticated API. The server remains the authority for authentication and usage checks.
- The proposal's cloud project restore, narration, and 1080p output are explicitly marked as planned. Current rendering stays at 720p and daily allowance comes from the existing service.

## UI verification

From the root: `npm.cmd run typecheck -w frontend`, `npm.cmd test -w frontend`, and `npm.cmd run build -w frontend`.

Photographs are downloaded assets from Unsplash: `photo-1476514525535-07fb3b4ae5f1` (alpine lake), `photo-1518837695005-2083093ee35b` (ocean), and `photo-1519608487953-e999c86e7455` (city at night). They illustrate sample stories, not user uploads.
