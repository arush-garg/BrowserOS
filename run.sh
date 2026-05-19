#!/usr/bin/env bash
# Launch BrowserOS with your existing production profile + dev agent extension
# This preserves all your data (bookmarks, history, settings, etc.)
# while replacing the built-in agent with your local dev build.

set -euo pipefail

BROWSEROS_BINARY="/Applications/BrowserOS.app/Contents/MacOS/BrowserOS"
AGENT_EXT_DIR="$(cd "$(dirname "$0")" && pwd)/packages/browseros-agent/apps/agent/dist/chrome-mv3-dev"
PRODUCTION_PROFILE="$HOME/Library/Application Support/BrowserOS"

# Ports (matching .env.development)
CDP_PORT="${BROWSEROS_CDP_PORT:-9005}"
SERVER_PORT="${BROWSEROS_SERVER_PORT:-9105}"
EXTENSION_PORT="${BROWSEROS_EXTENSION_PORT:-9305}"

# Build dev agent extension if missing or source files changed
AGENT_APP_DIR="$(cd "$(dirname "$0")" && pwd)/packages/browseros-agent/apps/agent"
BUILD_MARKER="$AGENT_EXT_DIR/.build-hash"

compute_src_hash() {
  # Hash the actual WXT app sources; ignore generated output and dependencies.
  if [ -d "$AGENT_APP_DIR" ]; then
    find "$AGENT_APP_DIR" \
      -path "$AGENT_APP_DIR/dist" -prune -o \
      -path "$AGENT_APP_DIR/node_modules" -prune -o \
      -path "$AGENT_APP_DIR/.wxt" -prune -o \
      -type f -print | sort | xargs cat 2>/dev/null | shasum | cut -d' ' -f1
  else
    echo "missing"
  fi
}

CURRENT_HASH=$(compute_src_hash)
NEEDS_BUILD=false

if [ ! -f "$AGENT_EXT_DIR/manifest.json" ]; then
  echo "🔨 Dev agent extension not found, building..."
  NEEDS_BUILD=true
elif [ ! -f "$BUILD_MARKER" ]; then
  echo "🔨 No build marker found, rebuilding..."
  NEEDS_BUILD=true
else
  STORED_HASH=$(cat "$BUILD_MARKER" 2>/dev/null || echo "")
  if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
    echo "🔨 Source files changed, rebuilding agent extension..."
    NEEDS_BUILD=true
  fi
fi

if [ "$NEEDS_BUILD" = true ]; then
  (cd "$(dirname "$0")/packages/browseros-agent/apps/agent" && bun run build:dev)
  if [ ! -f "$AGENT_EXT_DIR/manifest.json" ]; then
    echo "❌ Build failed — extension still not found at: $AGENT_EXT_DIR"
    exit 1
  fi
  echo "$CURRENT_HASH" > "$BUILD_MARKER"
  echo "✅ Agent extension built!"
fi

# Verify BrowserOS binary exists
if [ ! -f "$BROWSEROS_BINARY" ]; then
  echo "❌ BrowserOS binary not found at: $BROWSEROS_BINARY"
  exit 1
fi

# Kill any existing processes on our ports
echo "🧹 Clearing ports $CDP_PORT, $SERVER_PORT, $EXTENSION_PORT..."
lsof -ti:$CDP_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:$SERVER_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:$EXTENSION_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true

echo "🚀 Launching BrowserOS with production profile + dev agent..."
echo "   Profile: $PRODUCTION_PROFILE"
echo "   Extension: $AGENT_EXT_DIR"
echo "   CDP: http://127.0.0.1:$CDP_PORT"
echo ""

# Launch BrowserOS with production profile but dev agent
"$BROWSEROS_BINARY" \
  --no-first-run \
  --no-default-browser-check \
  --use-mock-keychain \
  --show-component-extension-options \
  --disable-browseros-server \
  --disable-browseros-extensions \
  --remote-debugging-port="$CDP_PORT" \
  --browseros-mcp-port="$SERVER_PORT" \
  --browseros-extension-port="$EXTENSION_PORT" \
  --user-data-dir="$PRODUCTION_PROFILE" \
  --load-extension="$AGENT_EXT_DIR" \
  --restore-last-session \
  chrome://newtab &

BROWSER_PID=$!
echo "BrowserOS PID: $BROWSER_PID"

# Wait for CDP to be ready
echo "⏳ Waiting for CDP..."
for i in $(seq 1 30); do
  if curl -s "http://127.0.0.1:$CDP_PORT/json/version" > /dev/null 2>&1; then
    echo "✅ CDP ready!"
    break
  fi
  sleep 1
done

# Start the dev server
echo "🔧 Starting dev server on port $SERVER_PORT..."
cd "$(dirname "$0")/packages/browseros-agent"
BROWSEROS_CDP_PORT=$CDP_PORT \
BROWSEROS_SERVER_PORT=$SERVER_PORT \
BROWSEROS_EXTENSION_PORT=$EXTENSION_PORT \
NODE_ENV=development \
bun run --filter @browseros/server start &

SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server health to avoid startup race with extension requests.
echo "⏳ Waiting for server health..."
for i in $(seq 1 45); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "❌ Server process exited before becoming healthy"
    exit 1
  fi

  if curl -sf "http://127.0.0.1:$SERVER_PORT/health" > /dev/null 2>&1; then
    echo "✅ Server healthy!"
    break
  fi

  if [ "$i" -eq 45 ]; then
    echo "❌ Server did not become healthy in time on port $SERVER_PORT"
    exit 1
  fi

  sleep 1
done

echo ""
echo "✅ BrowserOS running with dev agent!"
echo "   Press Ctrl+C to stop everything."

# Wait for either process
wait -n "$BROWSER_PID" "$SERVER_PID" 2>/dev/null || wait
