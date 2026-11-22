#!/usr/bin/env bash
# Wavefront — temporary launcher
# Serves the built React app on 10.0.0.50:8090
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

HOST="${HOST:-10.0.0.50}"
PORT="${PORT:-8090}"

export NODE_ENV="${NODE_ENV:-production}"

# ---------------------------------------------------------------- locate node
if ! command -v node >/dev/null 2>&1; then
  for candidate in \
    /var/lib/t3code/.nix-profile/bin/node \
    "$HOME/.nix-profile/bin/node" \
    /run/current-system/sw/bin/node \
    /usr/local/bin/node \
    /usr/bin/node; do
    if [ -x "$candidate" ]; then
      export PATH="$(dirname "$candidate"):$PATH"
      break
    fi
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install Node 22+ (node:sqlite is required)." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "error: Node 22+ required (found $(node -v))." >&2
  exit 1
fi

# ------------------------------------------------------------- dependencies
if [ ! -d node_modules ] || [ ! -d node_modules/react ]; then
  echo "==> Installing dependencies"
  npm install --no-audit --no-fund
fi

# --------------------------------------------------------------- build step
if [ ! -f dist/index.html ] || [ -n "$(find web/src web/index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "==> Building the frontend"
  npm run build
fi

# ------------------------------------------------------------------- run it
mkdir -p data

echo "==> Wavefront is starting"
echo "    http://${HOST}:${PORT}"
echo
exec env PORT="$PORT" HOST="$HOST" node server/index.js
