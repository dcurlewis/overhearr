# syntax=docker/dockerfile:1.7
#
# Overhearr production image.
#
# Build:   docker build -t ghcr.io/dcurlewis/overhearr:latest .
# Run:     docker run --rm -p 5056:5056 \
#            -e SESSION_SECRET=... -e ENCRYPTION_KEY=... \
#            -v /path/to/config:/config \
#            ghcr.io/dcurlewis/overhearr:latest
#
# Stages:
#   1. deps    — full npm install (incl. dev deps for build).
#   2. build   — prisma generate, next build, tsc server, prune to prod deps.
#   3. runtime — minimal alpine + tini, non-root, only runtime artifacts.

ARG NODE_VERSION=20-alpine
ARG APP_PORT=5056

# ---------- Stage 1: deps ----------
FROM node:${NODE_VERSION} AS deps

# Native deps (bcrypt) need build tools at install time. Alpine prebuilt
# bcrypt binaries don't exist for all combos, so we build from source.
RUN apk add --no-cache python3 make g++ libc6-compat openssl

WORKDIR /app

COPY package.json package-lock.json ./
# Force the @prisma/engines post-install to fetch openssl-3.0.x binaries
# instead of the openssl-1.1.x default. Alpine >=3.21 ships only OpenSSL 3,
# and Prisma's runtime detection sometimes guesses wrong on alpine.
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x,linux-musl-arm64-openssl-3.0.x
RUN npm ci --no-audit --no-fund

# ---------- Stage 2: build ----------
FROM node:${NODE_VERSION} AS build

RUN apk add --no-cache python3 make g++ libc6-compat openssl

WORKDIR /app

# Bring in deps from stage 1.
COPY --from=deps /app/node_modules ./node_modules

# Source. .dockerignore excludes tests, .next, dist, etc.
COPY . .

ENV NODE_ENV=production
# Prevent Next.js telemetry pings during the image build.
ENV NEXT_TELEMETRY_DISABLED=1
# Match the deps stage so any `prisma` reinstall during `npm prune`
# hits the same target list.
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x,linux-musl-arm64-openssl-3.0.x

# Generate the Prisma client (writes into node_modules/.prisma).
RUN npx prisma generate

# Build Next.js (standalone output) + compile the Express server to dist/.
RUN npm run build

# Drop dev deps + optional deps. The biggest optional offender is
# @playwright/test (~50 MB) which next.js declares as an optional peer
# dep and which is useless in a runtime image. `prisma` was moved to
# runtime deps in package.json so the migrate-deploy CLI is still
# available after the prune.
RUN npm prune --omit=dev --omit=optional

# Strip out anything else we know is build-only / dead weight at runtime.
# The Prisma engines for non-host platforms can be hundreds of MB; we
# only need the linux-musl-arm64-openssl-3.0.x or linux-musl-x64-openssl-3.0.x
# binary. Likewise, source maps and .d.ts files aren't needed at runtime.
RUN set -eux; \
    # Drop Prisma engines we won't use at runtime. The image is built
    # per-arch (single-arch); keeping the foreign-arch binary nearly
    # doubles the image. We detect the host arch dynamically so the same
    # Dockerfile works for both linux/amd64 and linux/arm64 builds.
    arch="$(node -p 'process.arch === "arm64" ? "arm64-" : ""')" && \
    keep_pattern="linux-musl-${arch}openssl-3.0.x" && \
    for dir in /app/node_modules/@prisma/engines /app/node_modules/.prisma/client; do \
        [ -d "$dir" ] || continue; \
        find "$dir" -maxdepth 1 -type f \
            \( -name 'libquery_engine-*' -o -name 'query-engine-*' \
               -o -name 'schema-engine-*' -o -name 'migration-engine-*' \) \
            ! -name "*${keep_pattern}*" \
            -delete 2>/dev/null || true; \
    done; \
    cd /app && \
    # Pure-developer leftovers that npm prune sometimes misses.
    rm -rf node_modules/@types node_modules/typescript \
           node_modules/.cache 2>/dev/null || true; \
    # Trim massive but unused docs/test trees inside packages.
    find node_modules -type d \
        \( -name test -o -name tests -o -name __tests__ \
           -o -name docs -o -name doc -o -name examples \
           -o -name '.github' \) \
        -prune -exec rm -rf {} + 2>/dev/null || true; \
    # Source maps and TS declarations are dead weight at runtime.
    find node_modules -type f \
        \( -name '*.map' -o -name '*.ts' \) \
        -not -path '*/@prisma/client/*' \
        -delete 2>/dev/null || true; \
    find node_modules -type f -name '*.md' -delete 2>/dev/null || true

# ---------- Stage 3: runtime ----------
FROM node:${NODE_VERSION} AS runtime

# tini for proper PID 1 / signal handling. libc6-compat for the bcrypt
# native binary. openssl is required at runtime by the Prisma migration
# engine. wget is used by the healthcheck.
RUN apk add --no-cache tini libc6-compat openssl wget

WORKDIR /app

# The official node:alpine image already ships a `node` user (uid 1000).
# We reuse it instead of creating a new one so file ownership lines up
# with the common Unraid PUID=1000 / PGID=1000 pattern.

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5056
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info
# Production DB lives under the bind-mounted /config volume. The Prisma
# SQLite path is absolute so it's resolved independent of CWD/schema dir.
ENV DATABASE_URL=file:/config/db/overhearr.db

# Pruned production node_modules (incl. the generated Prisma client).
COPY --from=build --chown=node:node /app/node_modules ./node_modules

# Compiled Express server.
COPY --from=build --chown=node:node /app/dist ./dist

# Next.js build output. We use the regular .next/ tree (not the standalone
# minimal server) because the runtime is the Express server which calls
# next() programmatically and expects the full .next/ layout. The
# .next/cache directory is excluded — it's only useful at build time.
COPY --from=build --chown=node:node /app/.next/BUILD_ID ./.next/BUILD_ID
COPY --from=build --chown=node:node /app/.next/build-manifest.json ./.next/build-manifest.json
COPY --from=build --chown=node:node /app/.next/prerender-manifest.json ./.next/prerender-manifest.json
COPY --from=build --chown=node:node /app/.next/routes-manifest.json ./.next/routes-manifest.json
COPY --from=build --chown=node:node /app/.next/react-loadable-manifest.json ./.next/react-loadable-manifest.json
COPY --from=build --chown=node:node /app/.next/required-server-files.json ./.next/required-server-files.json
COPY --from=build --chown=node:node /app/.next/server ./.next/server
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# Public assets (favicon, logo, etc).
COPY --from=build --chown=node:node /app/public ./public

# Prisma schema + migrations are required at runtime for `migrate deploy`.
COPY --from=build --chown=node:node /app/prisma ./prisma

# package.json — read by the server at startup for the version banner.
COPY --from=build --chown=node:node /app/package.json ./package.json

# Entrypoint script handles dir creation, migrations, and server start.
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Pre-create /config so a missing bind-mount still works (entrypoint also
# does this, but having it owned by `node` from the start avoids a perms
# scuffle on first boot when the host volume is fresh and empty).
RUN mkdir -p /config/db && chown -R node:node /config

USER node

EXPOSE 5056

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --spider --quiet "http://localhost:${PORT:-5056}/api/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
