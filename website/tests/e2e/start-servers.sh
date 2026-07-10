#!/usr/bin/env bash
# Start the fixture static server and Vite dev server together so Playwright
# can treat this as a single foreground webServer. When Playwright kills this
# process, the trap tears down both children.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/fixture-catalog"

cleanup() {
  [[ -n "${FIXTURE_PID:-}" ]] && kill "$FIXTURE_PID" 2>/dev/null || true
  [[ -n "${VITE_PID:-}" ]] && kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npx http-server "$FIXTURE_DIR" -p 8090 --cors -c-1 --silent &
FIXTURE_PID=$!

VITE_CATALOG_BASE_URL=http://localhost:8090 npx vite --port 5173 &
VITE_PID=$!

# Wait on vite (the long-lived, foreground-ish process). If it exits, tear down.
wait "$VITE_PID"
