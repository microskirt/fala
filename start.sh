#!/usr/bin/env bash
# Wavefront — temporary launcher
# Builds the React app if needed, then serves it on 0.0.0.0:8090 by default.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

# Bind to every interface by default so the app works on any machine.
# Override with HOST=127.0.0.1 (local only) or a specific LAN IP.
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8090}"

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
  echo "error: node not found. Install Node 18+ and try again." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "error: Node 18+ required (found $(node -v))." >&2
  exit 1
fi

# ------------------------------------------------------------- dependencies
# Check for the build tool as well as a runtime dep: a tree can be half
# installed (e.g. devDependencies skipped) and still contain node_modules.
if [ ! -x node_modules/.bin/vite ] || [ ! -d node_modules/react ]; then
  echo "==> Installing dependencies"
  # --include=dev: NODE_ENV=production in the caller's environment would
  # otherwise skip devDependencies, and vite is one of them.
  npm install --include=dev --no-audit --no-fund
fi

# --------------------------------------------------------------- build step
if [ ! -f dist/index.html ] || [ -n "$(find web/src web/index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "==> Building the frontend"
  npm run build
fi

# ------------------------------------------------------------------- run it
echo "==> Wavefront is starting"
echo "    http://${HOST}:${PORT}"
echo
exec env PORT="$PORT" HOST="$HOST" node server/index.js
