# ReelCraft security audit

Date: November 10, 2026. Scope: local repository, reachable Git history, installed dependency tree, local test fixtures and builds. No push, commit, deployment, credential rotation, production configuration change, or live attack testing was performed.

## Executive summary

Two local audit/remediation passes hardened authentication, realtime resource usage, quota accounting, saved-script validation, sensitive logging, HTTP parsing order, browser headers and Firestore access. The second pass fixed additional abuse and persistence race paths, added real emulator coverage, and migrated vulnerable dependencies. The current npm advisory scan reports zero known vulnerabilities. All 254 application/emulator tests pass. This is not a certification of complete security; deployed controls and browser integrations still require release verification.

## Architecture and sensitive data

- npm workspaces: shared Zod schemas, Express API, Next.js/React frontend. Firebase Hosting serves the static export; Render hosts the API and Socket.IO.
- Firebase Authentication provides Google and email/password login. The client sends bearer ID tokens; the backend verifies them. Client logout clears the Firebase session; it does not revoke previously stolen tokens across all devices.
- Firestore Admin SDK stores user profiles and server-controlled roles, projects (prompts, memos, captions and progress), daily counters, network hashes, restrictions and administrative audit records. There is no SQL database or payment implementation in the inspected application.
- Groq receives prompts, memos and optional JPEG grids. Epidemic Sound receives a hashed account identifier and music requests. IPinfo receives public IPs when enabled; persisted activity uses salted IP hashes. Videos, FFmpeg processing and Kokoro voice synthesis run in the browser. Voice audio and models can persist in browser caches.
- Private provider credentials stay in backend environment variables. Firebase web configuration is public configuration, not an authorization secret. Emulator-only sample credentials and the fake private-key test fixture are not production credentials.

## Vulnerabilities found and fixes

| Severity | Affected files | Finding and remediation |
| --- | --- | --- |
| High | backend/src/services/auth.ts | Default Firebase verification did not check revocation/disabled users. Enabled `verifyIdToken(token, true)` and bounded token size. HTTP and Socket.IO use this verifier. |
| High | backend/src/services/realtime.ts | Non-function client acknowledgement values could throw from an async listener outside its error boundary. Normalize the acknowledgement before use; added a malformed argument regression test. Recheck token validity on progress events and retain active-account/ownership checks. |
| Medium | backend/src/routes/index.ts | A database/logging/notification failure after an answered AI request refunded the quota despite upstream spending. Retain the charge once an answer has been received; still refund zero-answer results. Added a persistence failure regression test. |
| Medium | backend/src/services/script.ts | Invalid model output and provider error messages could enter logs, exposing prompt-derived private content. Replaced them with fixed diagnostic messages. |
| Medium | backend/src/config/env.ts | Production could inherit Firebase emulator settings, allowing emulator token acceptance or redirected persistence. Production now rejects Auth and Firestore emulator variables. |
| Low | backend/src/app.ts | Request logs included query strings; private API responses lacked a consistent cache prohibition. Log only paths and set `Cache-Control: no-store` across `/api`. |
| Low | frontend/next.config.js, firebase.json | Added CSP restrictions on base URLs, objects, framing and form destinations, plus nosniff and referrer policy in both hosting modes. This deliberately limited CSP does not yet restrict script sources. |
| Critical/high/moderate | workspace package manifests, package-lock.json | Updated Next.js to 15.5.29, migrated Vitest 2 to 4.1.12 and Zod 3 to 4.6.7, and patched gRPC/PostCSS/sharp/minimatch transitives. Migrations passed existing tests and builds; the final advisory scan reports zero findings. Minimum Node requirement is now ^20.19.0 or >=22.12.0 to match the tooling. |
| Medium | backend/src/services/realtime.ts | Invalid, rate-limited and unauthorized events reset the idle timer; overlapping events queued expensive backend work; failed writes were marked as persisted. Only authorized valid events refresh activity, only one progress operation runs per socket, and stages are remembered only after a successful write. Revoked tokens disconnect the socket. |
| Low | backend/src/services/realtime.ts | CORS alone did not restrict WebSocket origins, and transport connections were allocated before the namespace connection cap. Added early transport admission with an origin allowlist and connection capacity check. Origin-less native clients still require bearer authentication; origin checks are not authentication. |
| Medium | backend/src/app.ts | Malformed/oversized bodies failed before reaching the request limiter, allowing parser work outside its quota. Moved JSON parsing after the existing global burst guard; malformed-body regression verifies the 121st request gets 429. |
| Medium | shared/src/schemas.ts | Saved script edits accepted unconstrained scene arrays and narration strings within the HTTP body ceiling. Added scene count/ID limits and caption/voiceover limits of 80 characters (matching the editor); provider output retains its separate repair flow. |
| Medium | backend/src/routes/index.ts | A failed refund acknowledgement retried a potentially committed refund in the catch handler. Clear the refund-pending flag before attempting the refund, preventing an accidental second decrement. |
| Medium | firestore.rules | Suspended/deactivated accounts could bypass API enforcement through direct owner reads. Added active-profile checks supporting stored timestamps and legacy numeric milliseconds, denying malformed status values and orphaned accounts. All client writes remain denied. |
| Medium | backend/src/services/projects.ts | Merge writes could recreate an ownerless project after a concurrent delete. Use Firestore update preconditions for patches and progress; real Admin SDK emulator regression confirms deleted documents stay absent. |

## Authorization, injection and rules review

Inspected all API route definitions, admin service transaction checks, project stores, realtime listeners, network middleware, provider services, shared schemas, authentication client, browser media paths, hosting configuration and dependency scripts. Unauthenticated health is intentional. Authenticated project reads/patches/deletes use the verified UID and return 404 for another owner. Patch schemas exclude owner and role fields. Admin operations verify stored roles; mutation transactions recheck the actor, target version and support-role restrictions. AI models have no privileged tools or credential access; structured responses remain untrusted and are validated. No application HTML injection rendering or backend shell execution of user input was found in the reviewed runtime paths. Provider hosts are fixed; IPinfo refuses redirects and non-public IP lookups.

Firestore prototype rules remain deny-by-default and deny all client writes. Allowed owner reads now also require an existing active profile. Suspended, deactivated, malformed-status and orphaned accounts are denied. Both numeric legacy suspension times and Firestore timestamps are covered. Existing owner-filtered queries continue to work; cross-owner and unscoped queries fail. The backend Admin SDK intentionally bypasses rules and retains its independent authorization checks.

The isolated Firestore emulator compiled and evaluated the actual rules. Tests cover public access, owner and filtered-query access, cross-account reads (including an admin client), numeric/timestamp suspension/deactivation, expired suspensions, restoration, malformed state, orphaned profiles, self-role escalation, owner replacement, oversized updates, deletion, server-only counters/config/audit paths and subcollections. Client creates and updates are categorically denied, so field-validation bypasses cannot grant a client write. The additional Admin SDK test confirms a deleted project cannot be recreated by a late update.

Rules auditor assessment (local prototype only, not deployed-state verification):

```json
{"score":5,"summary":"Owner-only active-account reads and server-only writes passed local emulator authorization tests.","findings":[]}
```

The rules add a profile lookup to permitted reads. Cached lookups within an evaluation may reduce duplicate work, but verify production read cost and latency. Review and verify the prototype before broadly sharing the app. No production rules were deployed.

## Secrets review

Scanned all 16 reachable commits for private-key blocks and common Groq, AWS access-key and GitHub token patterns, emitting paths only. The sole match was `backend/test/firebase.test.ts`, containing a deliberately fake key. Reviewed environment handling, ignore rules and frontend public configuration. A matching-pattern scan of 132 generated build files found 0 matches. No confirmed live secret exposure was identified by these checks, so no specific rotation is asserted necessary. Pattern scanning cannot establish the absence of all credentials or assess unreachable/deleted Git objects. Ignored local environment files were not copied into this report.

## Verification results

- Type checking: passed (`npm.cmd run typecheck`).
- ESLint: passed (`npm.cmd run lint`).
- Tests: 147 backend, 94 frontend and 13 Firestore emulator tests passed (254 total), including cross-account CRUD, role escalation, suspended sessions, input validation, network restrictions, rate/usage limits and realtime ownership tests.
- Regression tests cover both passes: Firebase revocation, downstream-failure quota retention, single-attempt refunds, no-store responses, production emulator rejection, malformed socket acknowledgements, origin restrictions, idle abuse, concurrent progress writes and retry, request parsing order, saved-script bounds, direct Firestore authorization and deleted-project races.
- Production build: passed; Firebase production static export also passed.
- `git diff --check`: passed.
- Initial test startup failed under the filesystem sandbox; rerun with normal access succeeded. PowerShell initially blocked npm.ps1; checks use npm.cmd.
- Dependency audit initially failed under restricted networking, then completed with broader access. Advisory exit code 1 indicates findings, not an unavailable scan. Raw final results are in `security-dependencies.json`.
- Non-fatal warnings: Hugging Face `import.meta` handling, missing Next-specific ESLint plugin, Vitest config module-format migration warning, and the existing Windows static-export shell invocation warning. The export shell receives fixed repository-controlled commands; no untrusted input is interpolated.
- `npm.cmd run test:rules`: 13 tests passed against a loopback demo project, including rules compilation and actual Admin SDK persistence operations. It builds shared/backend first. Requires Java 21+ and downloads pinned Firebase CLI 15.35.0 through npx when not cached; the CLI itself is transient tooling outside the application lockfile advisory scan. Its transitive packages emitted deprecation notices. Fixtures refuse any endpoint other than 127.0.0.1:8085 and use demo-reelcraft-security; no customer data or production credentials are used.
- Patched sharp native smoke check passed (generated a 2x2 PNG in memory); dependency-tree validation reports no invalid overrides.
- No browser end-to-end OAuth, deployed security-header, real provider revocation, live App Check, music-license or infrastructure IAM tests were run. Local tests do not prove live service configuration.

Dependency results: the initial audit reported 32 affected packages, the first remediation pass reduced this to 17, and the second pass reports **zero known vulnerabilities**, including development dependencies. `security-dependencies.json` records the final advisory output. A clean advisory result is not proof that dependencies are free of vulnerabilities. Scoped minimatch and global sharp overrides intentionally move beyond their upstream requested ranges; lint, builds, unit tests and a native sharp smoke check passed, but upstream compatibility should be monitored. No runtime functionality was removed or Firebase downgraded.

## Remaining risks and manual actions

1. Keep the lockfile and overrides under dependency monitoring. Use an actively supported Node LTS satisfying the updated engine requirement; validation used Node 24.21.0. Keep test/development servers off public networks and verify voice/model behavior in staging after the dependency changes.
2. Review and release the locally tested prototype Firestore rules through the normal approval process; verify deployed rules match the intended version. Local changes do not change current production access. Do not broaden write access. Review least-privilege service account IAM and storage bucket permissions in the cloud consoles; no Storage rules/bucket policy is provided here.
3. Verify Firebase authorized domains, enabled sign-in providers, provider abuse protections and App Check enforcement. The local API cannot rate-limit direct Firebase signup/password-reset requests. No email verification requirement was added to existing user flows.
4. Verify proxy topology before trusting `TRUST_PROXY_HOPS=1`. Numeric hop trust assumes all production ingress traverses the intended proxy. Process-local burst guards and Socket.IO connection limits are per instance; use a shared limiter/adapter before scaling horizontally. Firestore daily quota transactions remain shared.
5. Verify HTTPS, headers, Google popup/redirect sign-in, App Check, model downloads, voice generation, music and FFmpeg rendering in a staging browser. The CSP is baseline protection, not a complete script-execution policy; add nonce/hash-based restrictions only with compatibility testing.
6. Firebase revocation checks require provider availability and add network work, including on realtime progress. Verification failure now disconnects an emitting socket. Idle sockets still expire on the existing idle/max timeout, so suspension/revocation is not an immediate server-push disconnection mechanism. Early connection limits bound allocated transports but do not replace infrastructure DDoS controls or per-account handshake quotas.
7. A zero-answer AI result is still refunded under existing product behavior; upstream timeouts can be ambiguous about billing. Configure provider-side spending limits and review this policy if paid usage is enabled. Music calls and Firestore reads have burst controls, not hard global spending guarantees.
8. Browser auth persistence and voice/model caches survive reloads; on shared devices, review cache clearing and retention expectations. Establish retention/deletion for prompts, memos, usage/network logs and admin audit PII, and avoid raw error logging from third-party SDKs that might include sensitive metadata.
9. Deploy these changes only after a separate release decision. No live credentials, provider dashboards, production variables, rules, hosting or payment configuration were modified. Rotate credentials if independent history/account investigation identifies exposure.

## Production readiness

Local remediation and verification are complete for the findings documented above; no known dependency advisories remain in the current scan. Unconditional production approval is still withheld pending review/release of the prototype rules, cloud configuration/IAM verification and staging browser integration checks. No push or deployment was performed. These changes do not certify the entire system secure.

## References

- [OWASP Top 10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/)
- [OWASP API Security Top 10](https://devguide.owasp.org/en/07-training-education/07-api-top-ten/)
- [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase session revocation](https://firebase.google.com/docs/auth/admin/manage-sessions)

- [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration.html)
- [Zod 4 migration guide](https://zod.dev/v4/changelog)
- [Socket.IO origin restrictions](https://socket.io/docs/v4/handling-cors)
- [Firestore rules timestamp comparison](https://firebase.google.com/docs/reference/rules/rules.Timestamp_)
