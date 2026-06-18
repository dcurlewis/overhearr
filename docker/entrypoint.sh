#!/bin/sh
# Overhearr container entrypoint.
#
# Responsibilities:
#   1. Make sure the bind-mounted /config tree exists.
#   2. Apply pending Prisma migrations against the production SQLite DB.
#   3. exec the Node server (so it inherits PID 1 from tini).
#
# All env tweaking should already have happened by the time we get here
# (Dockerfile sets defaults; user overrides via -e or compose).

set -eu

CONFIG_DIR="${CONFIG_DIR:-/config}"
DB_DIR="${CONFIG_DIR}/db"
# Image-proxy cache (see IMAGE_CACHE_DIR; defaults to /config/cache/images).
CACHE_DIR="${CONFIG_DIR}/cache/images"

mkdir -p "${DB_DIR}" "${CACHE_DIR}"

# Defensive: if the bind-mount was created with different ownership on
# the host, we may not be able to write here. Surface that early with a
# clear error rather than letting Prisma fail later.
if [ ! -w "${DB_DIR}" ]; then
  echo "[entrypoint] ERROR: ${DB_DIR} is not writable by uid=$(id -u)." >&2
  echo "[entrypoint] Fix the bind-mount permissions on the host (chown 1000:1000)." >&2
  exit 1
fi

echo "[entrypoint] running prisma migrate deploy..."
npx --no-install prisma migrate deploy

echo "[entrypoint] starting overhearr..."
exec node dist/server/index.js
