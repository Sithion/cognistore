#!/usr/bin/env bash
# Try the CURRENT checkout locally, before publishing anything.
#
#   scripts/local-test.sh web  [--copy-db] [--no-build] [--port N]
#   scripts/local-test.sh app  [--copy-db]
#
# web: builds, then runs the sidecar + the built dashboard in a sandbox HOME and
#      prints the URL to open in a browser. Fast; no installer needed.
# app: builds the real desktop bundle (AppImage on Linux, dmg on macOS) and
#      launches it with HOME pointing at the same sandbox, so the packaged app
#      (embedded sidecar, Tauri shell, upgrade path) is exercised end to end.
#
# Safety: your real ~/.cognistore is never opened for writing. --copy-db makes a
# consistent copy of it (SQLite backup API, read-only source) into the sandbox,
# which is how to try an upgrade against your own data. Agent configs
# (~/.claude, ~/.codex, ...) are not touched because HOME is the sandbox.
# The MCP server your agent sessions run via npx keeps using the real database.
set -euo pipefail

MODE="${1:-}"; shift || true
COPY_DB=0; BUILD=1; PORT=3299
while [ $# -gt 0 ]; do
  case "$1" in
    --copy-db) COPY_DB=1 ;;
    --no-build) BUILD=0 ;;
    --port) PORT="${2:?--port needs a value}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$MODE" in web|app) ;; *) sed -n 2,19p "$0" | sed 's/^# \{0,1\}//'; exit 2 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The sandbox holds a copy of private knowledge: owner-only files, kept under
# the user's own cache directory instead of a predictable path in shared /tmp.
umask 077
SANDBOX="${COGNISTORE_LOCAL_TEST_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/cognistore-local-test}"
REAL_HOME="$HOME"

rm -rf "$SANDBOX"
mkdir -p "$SANDBOX/home/.cognistore"
echo "sandbox: $SANDBOX/home"

if [ "$COPY_DB" = 1 ]; then
  SRC="$REAL_HOME/.cognistore/knowledge.db"
  [ -f "$SRC" ] || { echo "no database at $SRC" >&2; exit 1; }
  # Backup API: consistent even while the app or an MCP session is writing.
  (cd "$ROOT/packages/core" && node -e "
    const Database = require('better-sqlite3');
    const src = new Database(process.argv[1], { readonly: true });
    src.backup(process.argv[2]).then(() => { src.close(); console.log('database copied'); })
      .catch((e) => { console.error(e.message); process.exit(1); });
  " "$SRC" "$SANDBOX/home/.cognistore/knowledge.db")
  [ -f "$REAL_HOME/.cognistore/settings.json" ] && cp "$REAL_HOME/.cognistore/settings.json" "$SANDBOX/home/.cognistore/settings.json" || true
  echo "NOTE: the sandbox now holds a copy of your real knowledge. Delete it when done: rm -rf \"$SANDBOX\""
fi

if [ "$MODE" = web ]; then
  if [ "$BUILD" = 1 ]; then (cd "$ROOT" && pnpm build); fi
  echo "starting sidecar on http://127.0.0.1:$PORT  (Ctrl-C to stop; sandbox is kept for inspection)"
  cd "$ROOT/apps/dashboard"
  exec env HOME="$SANDBOX/home" COGNISTORE_HOME="$SANDBOX/home/.cognistore" COGNISTORE_MANAGED=0 \
    COGNISTORE_DEV=1 SQLITE_PATH="$SANDBOX/home/.cognistore/knowledge.db" DASHBOARD_PORT="$PORT" \
    DASHBOARD_DIST_PATH="$ROOT/apps/dashboard/dist" TEMPLATES_PATH="$ROOT/apps/dashboard/templates" \
    node dist-server/index.js
fi

# app mode
(cd "$ROOT" && pnpm build)
(cd "$ROOT/apps/dashboard" && pnpm tauri:bundle)
case "$(uname -s)" in
  Linux)
    BUNDLE="$(ls -t "$ROOT"/apps/dashboard/src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null | head -1)"
    [ -n "$BUNDLE" ] || { echo "no AppImage produced" >&2; exit 1; }
    echo "launching $BUNDLE with HOME=$SANDBOX/home"
    exec env HOME="$SANDBOX/home" "$BUNDLE" ;;
  Darwin)
    APP="$(ls -dt "$ROOT"/apps/dashboard/src-tauri/target/release/bundle/macos/*.app 2>/dev/null | head -1)"
    [ -n "$APP" ] || { echo "no .app produced" >&2; exit 1; }
    echo "launching $APP with HOME=$SANDBOX/home"
    exec env HOME="$SANDBOX/home" "$APP/Contents/MacOS/$(ls "$APP/Contents/MacOS" | head -1)" ;;
  *) echo "unsupported OS" >&2; exit 1 ;;
esac
