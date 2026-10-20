# IPinfo Lite integration

The proposal's IPinfo work is connected to `POST /api/v1/ai/script`, the existing caption workflow. Valid, authenticated requests are enriched before usage is consumed or Groq is called. The editor's daily limits and existing Groq setup are unchanged.

## Enable country and ASN lookups

1. Get a Lite token from the [IPinfo dashboard](https://ipinfo.io/dashboard/token).
2. Set `IPINFO_TOKEN` and `IP_HASH_SALT` in the repo-root `.env` (or backend host secrets). Generate a salt with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it stable; changing it creates new network identifiers and resets the effective per-IP history/limits.
3. Set `TRUST_PROXY_HOPS=0` for direct local development and `1` for the configured Render proxy. Verify your host's actual proxy topology before enabling IP-based enforcement. A hop count is safe only if every permitted route to the app has that many trusted proxies.
4. Restart the backend. Missing `IPINFO_TOKEN` disables enrichment; configuring it without a salt prevents startup. The token is never sent to the browser.
5. For persistence, use the existing Firestore `(default)` database with `STORE=firestore` and backend Firebase credentials. `STORE=memory` is available for local development only; it loses network records on restart. No database is provisioned by this change.

Requests use `https://api.ipinfo.io/lite/<client-ip>` with an Authorization bearer token. IPv4 and IPv6 are normalized, including IPv4-mapped IPv6. Loopback, private, documentation and reserved addresses are not sent to IPinfo. Localhost will therefore show local/private with unknown country/ASN, which is expected.

## Cache, records and failures

- `ipInfoCache/{ipHash}` contains allowlisted country/ASN metadata and an `expiresAt` millisecond timestamp. Entries are reusable for 24 hours, then overwritten by the next successful lookup. Expiry is checked in application code; no paid TTL deletion service is required.
- `ipStats/{ipHash}_{YYYY-MM-DD}` contains the country, ASN, network name/domain, lookup status, watchlist flag, request count and distinct account count. Membership documents under `accounts/` make distinct counts transactional without an unbounded array. Counts cover validated requests that reach the network check, including those denied by step-up or daily limits; unauthenticated, malformed and burst-limited requests are excluded.
- Successful AI usage logs include the same network metadata. Only hashes and allowlisted fields are stored; provider response IPs and tokens are discarded. IPinfo itself necessarily receives the raw IP for the lookup.
- A failed, malformed or timed-out lookup returns unknown metadata and permits caption generation; account/IP/global limits still apply. Requests time out after 2.5 seconds and failures suppress new outbound lookups for 30 seconds. No failed lookup is cached for 24 hours. Simultaneous misses for the same hash share an in-flight lookup within one process.
- If IPinfo is unavailable and there is no valid cached ASN, ASN-based verification cannot be applied. This is an explicit availability tradeoff, not a guarantee of VPN detection. Database failure while recording/checking network security returns 503 before consuming AI quota.
- The 24-hour lookup freshness window is not a deletion policy for historical activity. The existing Firestore catch-all rules already deny client access to all new collections; only the backend Admin SDK can access them.

## Suspicious ASN verification

[IPinfo Lite](https://ipinfo.io/developers/lite-api) provides country and ASN information, **not VPN or datacenter detection**. `IPINFO_FLAGGED_ASNS` is an operator-maintained comma-separated watchlist such as `AS12345,AS67890`. It is empty by default. No network is silently classified as a VPN, and a match is not proof of abuse.

To enable step-up:

1. Register the existing Firebase web app for [App Check with reCAPTCHA v3](https://firebase.google.com/docs/app-check/web/recaptcha-provider), including the deployed frontend domains.
2. Set `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` in `frontend/.env.local` / frontend build environment. Set `FIREBASE_WEB_APP_ID` on the backend to the same public app ID used by `NEXT_PUBLIC_FIREBASE_APP_ID`.
3. Give the backend service account the **Firebase App Check Token Verifier** IAM role needed for [replay protection](https://firebase.google.com/docs/app-check/custom-resource-backend#replay_protection_beta). This must be configured in Firebase/Google Cloud; merely adding an environment variable is insufficient.
4. Configure the ASN watchlist on the backend and restart/rebuild the relevant apps.

A flagged request returns `403 NETWORK_VERIFICATION_REQUIRED` before AI quota is spent. The editor shows a link opening `/verify` in a new tab. This page is outside the editor's cross-origin isolation, allowing reCAPTCHA resources to load while the original tab retains the selected video files. It sends a fresh limited-use token to `POST /api/v1/me/network-verification` in `X-Firebase-AppCheck`. The backend checks the app ID, consumes the token to prevent replay, and grants the current account/network pair a 10-minute verification in `networkVerifications`. The user returns to the editor and retries. Verification does not bypass daily usage limits and does not transfer to another account or IP.

Signed device cookies, multi-account suspicion rules, account suspension management and IP restriction controls from the broader proposal remain separate features. This change implements the IPinfo ASN step-up path.

## Admin IP view

Open `/admin/ips`. It now displays real records, including loading, empty, error and access-denied states and IPinfo attribution. Other admin screens still use their existing preview data.

`GET /api/v1/admin/ips?day=2026-10-20&limit=50&cursor=...` requires a Firebase ID token and a server-owned `users/{uid}.role` of `support` or `admin`. Missing roles default to no access; deleted or currently suspended users cannot read the records. An operator can provision a role in the Firebase console for an existing Firebase Auth UID. The preview role selector never grants API access. Local memory-store roles are empty unless injected by a test; use Firestore or its emulator for a live admin session.

Responses contain `{ day, items, nextCursor }`, no raw IPs and no account UID lists. Dates are UTC; page size is 1–100, default 50. Use the returned cursor with the same day. Pages sort by hash for stable cursor pagination. No custom composite index is needed for the day filter plus document-ID order.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run lint`. Tests mock the external IPinfo/App Check calls; no real IP or secret is sent to a provider by the test suite. Coverage includes 24-hour expiry, concurrent misses, private/IPv6 addresses, malformed responses, timeouts, admin permissions/pagination, network verification scoping/expiry, and preservation of AI limits during provider failure.

For a live check after configuring credentials, generate captions through the deployed frontend, inspect `/admin/ips` with a support/admin account, and confirm repeated requests reuse `ipInfoCache`. To exercise verification, temporarily add the observed test network's ASN to the watchlist, complete `/verify`, retry captions, then remove the test entry. Do not spoof forwarding headers on a public deployment.
