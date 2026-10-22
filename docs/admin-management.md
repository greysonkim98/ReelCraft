# Admin management

All five `/admin` tabs use authenticated backend APIs and Firestore. Roles remain in the existing `users/{Firebase Auth UID}.role` field. Unknown or absent roles grant no management access. Existing profiles and roles are preserved. The frontend role selector and fictional admin data have been removed.

## Permissions and account restrictions

| Action                                                                         | Support                                          | Admin          |
| ------------------------------------------------------------------------------ | ------------------------------------------------ | -------------- |
| Overview, account search, daily usage, network activity and account membership | Yes                                              | Yes            |
| Suspend a regular user                                                         | Up to 7 days                                     | Up to 365 days |
| Lift a suspension                                                              | Support-issued suspensions of regular users only | Yes            |
| Change roles, deactivate or restore accounts                                   | No                                               | Yes            |
| Block/unblock a network's AI requests                                          | No                                               | Yes            |
| Runtime settings and audit log                                                 | No                                               | Yes            |

An operator cannot change their own account. Mutation transactions re-read both actor and target, preventing concurrent administrators from removing each other's authority and leaving no active administrator. Records include a version; stale updates return 409 and must be refreshed. Every mutation requires a reason. The change and its audit entry commit in the same Firestore transaction.

Deactivation is reversible: it sets `deletedAt` and blocks protected API requests, including requests using already-issued sign-in tokens. It does not erase the Firebase Auth identity, videos, project records, or historical logs. Restoration clears restrictions and resets the role to `user`. Suspensions expire automatically based on server time. The API checks account restrictions on each authenticated request. Socket connections and subsequent progress writes also check them. This is application access control; it does not remotely erase browser-local content or change the existing owner-only Firestore read rules.

Google and email/password login are supported on `/login`. Never store account passwords in Firestore or commit credentials. For real Firebase testing, leave `NEXT_PUBLIC_AUTH_EMULATOR` and backend emulator variables empty. The frontend retrieves the current server-owned role on page load; each API request independently verifies authorization.

## Runtime limits

`runtimeConfig/limits` stores `limits`, `version`, and `updatedAt`. Until initialized, values come from backend environment defaults. Saving changes takes effect on new requests without a process restart and preserves daily counters.

- `aiPerUserPerDay` and `globalDailyAiCap`: transactional AI quotas, reset at 00:00 UTC. Zero pauses generation.
- `ipDailyCap`: transactional shared-IP quota. Zero disables it; enabling it requires `IP_HASH_SALT` and a correctly configured trusted proxy. IP counters are collected while this cap is enabled.
- `maxOutputSeconds`: 3–60 seconds, checked in the editor and by the caption API against total scene duration.
- `maxClips`: 1–30 source clips, enforced by the local editor before importing, analyzing, generating captions, and rendering. Raw source files remain on the device, so the API cannot independently verify source-file counts.

The editor refreshes these controls before performing work. The old illustrative narration quota is not presented as an enforceable setting: there is no server-side narration service in this project.

## Collections

| Collection/document               | Purpose                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `users/{uid}`                     | Existing profile and role; adds `version`, `reason`, suspension/deactivation timestamps and operator role for support restrictions |
| `runtimeConfig/limits`            | Versioned runtime limits                                                                                                           |
| `adminAudit/{id}`                 | Actor UID/email/role, action, target, reason, before/after, server timestamp in milliseconds                                       |
| `networkRestrictions/{ipHash}`    | Block expiration in milliseconds, reason, version                                                                                  |
| `dailyStats`                      | Existing per-account, global and optional per-IP AI counters                                                                       |
| `ipStats/{ipHash}_{day}/accounts` | Existing distinct-account membership used by network details                                                                       |

Audit entries are append-only through the API; no edit or delete endpoint exists. Project administrators with direct database privileges can still manage Firestore. The existing deny-all fallback rules already protect the new collections from client reads and writes. No additional rules deployment is required. Queries use automatic single-field indexes; newest audit events sort by `createdAt` and paginate using document snapshots to handle timestamp ties.

## API

All paths below are under `/api/v1` and require a Firebase ID token.

- `GET /admin/overview`: account counts, seven UTC days of AI usage, effective limits; recent audit entries only for admins.
- `GET /admin/users?search=&status=&limit=50&cursor=`: bounded account search and daily usage. Search scans at most 500 profiles per request; a non-null cursor means more profiles remain, even if the current filtered page is empty.
- `POST /admin/users/:uid/actions`: `action` (`role`, `suspend`, `unsuspend`, `delete`, `restore`), `reason`, current `version`, and `role` or `days` where applicable.
- `GET /admin/ips?day=&limit=&cursor=`: daily network summaries.
- `GET /admin/ips/:hash?day=&limit=&cursor=`: account membership and current restriction.
- `PUT /admin/ips/:hash/restriction`: `blocked`, `days`, `reason`, current `version`. A block affects AI requests from all accounts sharing the hash, including verified accounts; it does not block login or project retrieval.
- `GET /admin/settings`, `PUT /admin/settings`: settings read/update; update body contains complete `limits`, `version`, and `reason`.
- `GET /admin/audit?limit=50&cursor=`: newest management events. The UI explicitly labels its text search as a search of loaded events.
- `GET /config`: effective runtime settings for any active signed-in creator.

## Validation

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run export -w @reelcraft/frontend`. Backend tests cover role boundaries, self-change protection, conflicting updates, restrictions on existing sessions, daily-cap changes, output duration, network blocks, pagination, and audit attribution.

Live setup tests should use temporary accounts and network records, then clean those fixtures up. Preserve audit entries so test operations remain attributable. No deployment or Groq key is required to manage accounts, settings, IP records, or audit history; actual caption generation still needs `GROQ_API_KEY`.
