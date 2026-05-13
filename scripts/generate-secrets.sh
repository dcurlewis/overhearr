#!/bin/sh
# Print a SESSION_SECRET + ENCRYPTION_KEY pair suitable for an Overhearr
# deployment. Pipe into `.env.docker` (or copy/paste into Unraid template
# fields) and treat the output as sensitive.
#
# Usage:
#   ./scripts/generate-secrets.sh
#   ./scripts/generate-secrets.sh > .env.docker

set -eu

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found in PATH; install it or generate hex manually." >&2
  exit 1
fi

echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
