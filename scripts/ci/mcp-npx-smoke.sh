#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
export npm_config_cache="$TMP_DIR/npm-cache"
cleanup() {
  node "$ROOT/apps/mcp-server/scripts/restore-workspace-deps.mjs"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$ROOT"
pnpm build --filter @cognistore/mcp-server
node apps/mcp-server/scripts/strip-workspace-deps.mjs
(cd apps/mcp-server && npm pack --pack-destination "$TMP_DIR")
TARBALL="$(find "$TMP_DIR" -maxdepth 1 -name 'cognistore-mcp-server-*.tgz' -print -quit)"
test -n "$TARBALL"

docker run --rm \
  --volume "$TARBALL:/tmp/cognistore-mcp-server.tgz:ro" \
  --volume "$ROOT/scripts/ci/mcp-npx-smoke.mjs:/tmp/mcp-npx-smoke.mjs:ro" \
  node:24-slim \
  sh -eu -c '
    for tool in python3 make g++; do
      if command -v "$tool" >/dev/null 2>&1; then
        echo "Unexpected toolchain executable: $tool" >&2
        exit 1
      fi
    done
    echo "PASS: python3, make, and g++ are absent"
    mkdir -p /tmp/mcp-install
    npm install --prefix /tmp/mcp-install --no-audit --no-fund /tmp/cognistore-mcp-server.tgz
    COGNISTORE_MCP_BIN=/tmp/mcp-install/node_modules/.bin/cognistore-mcp \
    COGNISTORE_MCP_PACKAGE_JSON=/tmp/mcp-install/node_modules/@cognistore/mcp-server/package.json \
      node /tmp/mcp-npx-smoke.mjs
  '
