# Changelog

All notable changes to Overhearr will be documented in this file. The
format is loosely based on [Keep a Changelog](https://keepachangelog.com/),
and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **`TRUST_PROXY=true` now trusts a single upstream hop.** Previously
  mapped to Express's `trust proxy = true` ("trust every hop"), which
  allowed `X-Forwarded-For` spoofing and triggered the
  `ERR_ERL_PERMISSIVE_TRUST_PROXY` advisory from `express-rate-limit` on
  every startup behind a proxy. The login rate limiter also explicitly
  opts out of that advisory now that we've made a deliberate choice.

### Changed

- **Discover sources rewritten.** Last.fm retired the `chart.gettopalbums`
  and `geo.gettopalbums` endpoints (silently — they return method-not-found
  for any new key), so two of the three Discover rows had been permanently
  empty since the underlying change. Replaced with:
  - **Top Albums** → ListenBrainz `/1/stats/sitewide/release-groups`
    (anonymous, no API key).
  - **Top Artists** → ListenBrainz `/1/stats/sitewide/artists`
    (anonymous, no API key).
  - **New Releases** → MusicBrainz release-group search restricted to the
    last month, sorted by `firstreleasedate` desc.
- **Discover is now zero-config.** Both replacement providers are anonymous
  public APIs, so a fresh install shows three populated rows immediately
  with no setup-wizard step and no Settings card to configure.

### Removed

- **Last.fm integration.** The wizard's Last.fm step, the Settings → Last.fm
  card, the `Settings.lastfmApiKeyEncrypted` DB column, and all related
  routes (`PATCH /api/settings/lastfm`) and code paths are gone. Migration
  to drop the column is additive — existing installs lose the stored key on
  upgrade (it was no longer functional anyway).
- **`DiscoverPayload.configured`.** The "Last.fm not configured" empty state
  no longer applies; the response shape is now just the three row arrays.

## [1.0.0] - 2026-05-13

First production release. A from-scratch modernization of the original
prototype: TypeScript-strict server, Prisma + SQLite, Next.js 14 App
Router frontend, full unit + integration + E2E test suite, hardened
production Docker image, and a Community Apps template for Unraid.

### Features

- **Discover.** Trending and per-genre charts via Last.fm, with fallback
  if no Last.fm key is configured.
- **Search.** MusicBrainz-backed artist + album search with album-art
  resolution.
- **Request.** One-click request a single album or a whole discography.
  Duplicate requests are deduplicated at the DB level.
- **Reconciliation.** Background worker polls Lidarr every 10 minutes and
  transitions outstanding requests `PENDING` → `PROCESSING` →
  `AVAILABLE` / `FAILED`. Manual retry for failed requests.
- **Settings UI.** Admins configure Lidarr (URL, API key, quality +
  metadata profile, root folder) and Last.fm entirely through the in-app
  Settings page; nothing in env vars beyond infra secrets.
- **Multi-user.** Admin and standard roles; admin-only access to settings
  and user management. Sessions persisted in the same SQLite DB.
- **Theme + mobile.** Light/dark theme toggle, fully responsive layout.
- **Encrypted secrets at rest.** Lidarr and Last.fm API keys encrypted
  with AES-256-GCM using `ENCRYPTION_KEY` before write.

### Deployment

- Multi-stage Dockerfile producing a 325 MB `node:20-alpine`-based image
  that runs as non-root uid 1000.
- `docker-compose.yml`, `.env.docker.example`, and
  `scripts/generate-secrets.sh` for self-hosters.
- Unraid Community Apps template at `unraid/overhearr.xml` with masked
  secret fields and sensible defaults for `/mnt/user/appdata/overhearr`.
- Healthcheck on `/api/health` (DB + Lidarr-configured indicators).
- Migrations applied automatically on container start; restarts are
  idempotent.

### Known limitations / v2 backlog

These are conscious cuts from v1 to keep the surface honest:

- **Plex SSO / OIDC.** Only username + password auth ships in v1.
- **Notifications.** No Discord / Pushover / email hooks for state
  changes yet.
- **Per-request quality.** Requests inherit the global quality + metadata
  profile; no per-album override.
- **Library sync indicator.** No visual "Lidarr just finished importing"
  push — status updates are pull-based via the reconciliation worker.
- **Approval workflow toggle.** All requests are auto-approved; an
  optional admin-approval gate is on the v2 list.
- **Similar-album recommendations.** The Discover page is curated by
  Last.fm charts only; no per-user collaborative filtering.
- **Internationalization.** UI is English-only.

### Notes

- `SESSION_SECRET` and `ENCRYPTION_KEY` MUST be unique, 64-char hex
  strings. Rotating `ENCRYPTION_KEY` after first use will invalidate
  stored Lidarr / Last.fm credentials — re-enter them in the UI.
- Behind a reverse proxy, set `TRUST_PROXY=true` so Express trusts
  `X-Forwarded-*` headers and emits secure cookies.
