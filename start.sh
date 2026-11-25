#!/usr/bin/env bash
# Fala launcher
# Builds the React app with bun if needed, then serves it on 0.0.0.0:8090.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

# Bind to every interface by default so the app works on any machine.
# Override with HOST=127.0.0.1 (local only) or a specific LAN IP.
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8090}"

# ---------------------------------------------------------------- locate bun
if ! command -v bun >/dev/null 2>&1; then
  for candidate in \
    "$HOME/.bun/bin/bun" \
    /var/lib/t3code/.bun/bin/bun \
    /usr/local/bin/bun \
    /usr/bin/bun; do
    if [ -x "$candidate" ]; then
      export PATH="$(dirname "$candidate"):$PATH"
      break
    fi
  done
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun not found. Install it with:" >&2
  echo "  curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

# ----------------------------------------------------------------- locate node
# The proxy server runs on node. Bun builds the frontend.
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
# Verify that every dependency declared in package.json actually resolves. A
# tree left over from an older package.json can still contain vite and react
# while missing a newer devDependency, which then fails inside vite itself.
missing_deps() {
  node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const missing = names.filter((n) => !fs.existsSync(`node_modules/${n}/package.json`));
    if (missing.length) console.log(missing.join(", "));
  '
}

MISSING="$(missing_deps)"
if [ -n "$MISSING" ]; then
  echo "==> Installing dependencies with bun (missing: $MISSING)"
  bun install
fi

# --------------------------------------------------------------- build step
if [ ! -f dist/index.html ] || [ -n "$(find web/src web/index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "==> Building the frontend"
  bun run build
fi

# ------------------------------------------------------------------- run it
echo "==> Fala is starting"
#
# The server binds every interface, but the address to open is localhost.
# Browsers treat localhost and 127.0.0.1 as secure even over plain http, and
# the key system that protected tracks need only exists on a secure origin.
# Opening 0.0.0.0 or a LAN IP instead makes those tracks fail to play.
echo "    http://localhost:${PORT}"
if [ "$HOST" = "0.0.0.0" ]; then
  echo "    (reachable on the LAN too, but protected tracks need localhost or https)"
fi
echo
exec env PORT="$PORT" HOST="$HOST" node server/index.js
