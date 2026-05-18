# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Development:
- `npm run dev` — `tsx watch` on the Express+Next entry (`server/index.ts`), port 5056.
- `npm run build` — `next build` then `tsc` + `tsc-alias` for the server (emits to `dist/`).
- `npm start` — runs the built server (`dist/server/index.js`) with `NODE_ENV=production`.

Quality gates (used by `npm run test:all`):
- `npm run typecheck` — `tsc --noEmit` across the whole workspace (single `tsconfig.json`).
- `npm run lint` — ESLint over `server/` and `src/` (cached).
- `npm test` — Vitest unit + integration suite (excludes E2E).
- `npm run test:e2e` — Playwright; the config boots `npm run dev` automatically.

Targeted test runs:
- Single file: `npx vitest run tests/integration/requests.test.ts`
- Single test name: `npx vitest run -t "rejects unauthenticated"`
- Watch mode: `npm run test:watch`
- Only unit / only integration: `npm run test:unit` / `npm run test:integration`
- E2E variants: `npm run test:e2e:ui` (UI), `npm run test:e2e:headed`, single file: `npx playwright test tests/e2e/album-request.spec.ts`

For changes that touch upstream HTTP integrations (MusicBrainz, ListenBrainz, Lidarr, Cover Art Archive), green test:all is necessary but not sufficient — msw intercepts at the HTTP module layer, so it doesn't catch DNS, IPv4/IPv6, TLS, or real-timeout regressions. After tests pass, smoke against the real services: `npm run dev`, run through the affected flow, and skim the logs for warns from the relevant client. The IPv6 hang in PR #16 would have shipped if I'd stopped at green.

Database (Prisma + SQLite):
- `npm run db:migrate` — `prisma migrate dev` (local schema changes).
- `npm run db:migrate:deploy` — applied automatically in the Docker entrypoint.
- `npm run db:reset` — wipes the local SQLite DB.
- `npm run db:studio` — Prisma Studio.

Setup for a fresh checkout: `npm ci`, copy `.env.example` to `.env` and fill `SESSION_SECRET` + `ENCRYPTION_KEY` (both `openssl rand -hex 32`), then `npm run db:migrate`.

## Architecture

**Single-process hybrid Express + Next.js.** `server/index.ts` boots Prisma, prepares a Next app, then builds the Express app via `server/appFactory.ts` and mounts the Next request handler as a fall-through for non-`/api` paths via `attachExtraHandlers`. One port, one container, shared session middleware, SSR via the Next App Router.

**`buildApp` (`server/appFactory.ts`) is the integration-test seam.** It returns a configured `Express` without calling `listen` or `prisma.$connect`. Integration tests (`tests/integration/_helpers.ts`) call it with their own `PrismaSessionStore` and a supertest agent. Per-file SQLite isolation is enforced by `tests/integration/setup-env.ts` (a vitest setupFile run in each forked worker before module eval) — every integration test file gets its own tmpdir DB and Prisma client. Cross-file pollution is impossible by construction; do not try to share state.

**Singleton upstream clients carry LRU caches; integration tests must clear them.** `lastfm`, `musicbrainz`, and `listenbrainz` (and any future client) are imported as long-lived singletons. Their internal caches survive between integration test cases inside the same file, and msw handler swaps don't invalidate them. Integration tests that touch these clients must call `<client>.clearCache()` in `afterEach` — see `tests/integration/discover.test.ts` for the pattern. Symptoms when you forget: the first test passes, subsequent tests appear to use stale data and fail mysteriously when re-ordered.

**API surface lives under `/api/*`.** Routers in `server/routes/` (auth, setup, users, profile, settings, search, music, discover, requests, health) call into services in `server/services/` (`authService`, `settingsService`, `requestService`, `requestLookupService`, `reconciliationWorker`). Upstream HTTP clients live in `server/api/{lidarr,musicbrainz,listenbrainz}/`. The Discover route fans out to ListenBrainz (top release-groups + artists, anonymous sitewide stats) and MusicBrainz (recent release-groups), per-section graceful degrade — neither requires an API key, so Discover is zero-config.

**Persistence: SQLite via Prisma, single DB for everything.** Schema in `prisma/schema.prisma`. Sessions are persisted in the same DB (`PrismaSessionStore` in `server/middleware/sessionStore.ts`) so the container is fully stateless across restarts — there is no Redis. The Prisma SQLite connector does not support enums, so `User.role`, `MusicRequest.type`, and `MusicRequest.status` are strings; allowed values are enforced at the service / Zod layer (see `server/types`). `Settings` is a singleton (id always = 1), enforced in `SettingsService`.

**Secrets at rest are AES-256-GCM encrypted with `ENCRYPTION_KEY`.** The Lidarr API key is encrypted before write (see `server/lib/crypto.ts`); rotating the key invalidates the stored credential.

**Reconciliation worker** (`server/services/reconciliationWorker.ts`) polls Lidarr every `RECONCILIATION_INTERVAL_MS` (default 10 min) and transitions `PENDING` → `PROCESSING` → `AVAILABLE`/`FAILED`. It is a **no-op when `NODE_ENV=test`** — tests call `runReconciliationOnce()` directly. Capped at 200 rows/tick; per-row errors are swallowed.

**CSRF is a custom-header check, not a token store** (`server/middleware/csrf.ts`). Mutating requests must carry `X-Overhearr-CSRF: 1`; combined with `sameSite=lax` session cookies and same-origin frontend serving, this is sufficient. Login and first-run setup are exempt. Integration tests must set both `CSRF_HEADER` and `RL_BYPASS` (`x-test-disable-rate-limit: 1`) headers — both are exported from `tests/integration/_helpers.ts`.

**Cookie `secure` flag is `'auto'`, not `isProduction`.** This is deliberate: a hardcoded `secure: true` broke LAN-direct HTTP installs because browsers refused to send Secure cookies over HTTP. `'auto'` follows `req.secure`, which honors `X-Forwarded-Proto` when `TRUST_PROXY=true`. Don't change this without re-reading the comment in `appFactory.ts`.

**`TRUST_PROXY=true` maps to Express `trust proxy = 1`, not `true`.** The boolean env is intentionally narrow: it means "trust *one* upstream hop." Passing literal `true` to Express ("trust every hop") allows `X-Forwarded-For` spoofing and trips `express-rate-limit`'s `ERR_ERL_PERMISSIVE_TRUST_PROXY` advisory. The rate limiter also opts out of the advisory via `validate.trustProxy: false` since we've made an explicit choice. If a deploy ever needs more hops or CIDR-based trust, widen the env schema rather than reverting the mapping.

**Helmet defaults are intentionally loosened.** CSP, COOP, and origin-agent-cluster are disabled because the default CSP blocks Next's inline hydration scripts and the FOUC theme suppression script in `_document.tsx`, and COOP/OAC require HTTPS. For public-internet deploys, terminate TLS at a reverse proxy and set CSP/HSTS there.

**Path aliases:** `@/*` → `src/*`, `@server/*` → `server/*` (see `tsconfig.json`). Vitest resolves these via `vite-tsconfig-paths`.

**Frontend** is in `src/` (Next.js Pages Router under `src/pages/`, components in `src/components/`, contexts in `src/context/`, SWR hooks in `src/hooks/`). Frontend unit tests live in `tests/unit/frontend/**` and run under `jsdom` per the `environmentMatchGlobs` rule in `vitest.config.ts`. The frontend is intentionally *not* extensively unit-tested — it is covered end-to-end by Playwright, which is why global vitest coverage thresholds are deliberately low (see comment in `vitest.config.ts`).

**Lidarr client quirks** (`server/api/lidarr/index.ts`): URL normalization (users paste `/api/v1`, trailing slashes, etc.); skyhook/MusicBrainz flakiness returns HTTP 200 with an error body — classified as `LidarrMetadataUnavailableError`; lookup endpoints try both `lidarr:<mbid>` and bare MBID; `addAlbum()` auto-adds the artist with `monitor:'none'` if needed.

**All outbound HTTP clients pin IPv4** via `new https.Agent({ family: 4 })`. MusicBrainz and ListenBrainz both have CDN paths where dual-stack DNS hands back AAAA records that black-hole instead of failing cleanly — Node defaults to IPv6 first, hangs the full timeout, and tests pass while production reads as a generic "upstream slow" issue. New upstream clients should follow the same pattern unless you've verified the host doesn't have this problem.

**Reading `package.json` at runtime: use `server/lib/packageVersion.ts#buildUserAgent(__dirname)`.** `__dirname` resolves to a different relative depth under `tsx watch` (`server/api/<x>/`), the compiled tree (`dist/server/api/<x>/`), and the Docker layout (where `package.json` is at `/app/`). The helper tries every plausible candidate plus a `process.cwd()` fallback. Don't reach for `require('../../../package.json')` directly — that's how a startup-crash bug shipped before.

## Conventions

- Server modules use absolute-from-baseUrl imports relative to the file's own tree (e.g. `../db/prisma`, `../lib/logger`); aliases are used in `src/`.
- Validation at API boundaries with Zod (`zod` is a runtime dep on the server).
- Logging via `pino` through `server/lib/logger.ts` — never `console.log`.
- Errors throw subclasses of the typed errors in `server/lib/errors.ts`; the `errorHandler` middleware maps them to HTTP responses.
- TypeScript is `strict` + `noUncheckedIndexedAccess`. Don't loosen these.
- Commit messages are short imperative subjects, no Conventional Commits prefix (see `git log`).

## Project spirit

Overhearr is "Overseerr for Lidarr" — a deliberately small, single-binary, single-SQLite-DB self-hosted app. Several things are *conscious cuts*, not missing features; do not propose adding them without an explicit ask:

- All requests are auto-approved — there is no admin approval workflow.
- No notifications (Discord / email / Pushover / webhooks).
- No per-request quality / metadata profile override; the global Settings profile is used.
- Username + password only — no Plex SSO / OIDC.
- English only — no i18n.
- Single Lidarr instance, single user-facing language, single SQLite DB. No Redis, no separate worker process.

The current backlog (and the rationale for these cuts) lives in the most recent `CHANGELOG.md` release section under "Known limitations". Outstanding work items are tracked as GitHub Issues — use `gh issue list` to see them, and check issue labels for the next-version milestone rather than assuming a fixed name.
