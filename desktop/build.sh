#!/bin/bash
set -euo pipefail

# ─── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$SCRIPT_DIR"
APP_BUNDLE="$DESKTOP_DIR/TeachingLearning.app"

echo "📦 Project root: $PROJECT_ROOT"

# ─── Toolchain resolution ─────────────────────────────────────────────────────
PYTHON3="$PROJECT_ROOT/backend/.venv/bin/python3"
if [[ ! -x "$PYTHON3" ]]; then
  echo "✗ venv Python not found at $PYTHON3"
  echo "  Run: cd backend && pip install -e '.[dev]'"
  exit 1
fi

NODE="$(which node 2>/dev/null || echo '')"
if [[ -z "$NODE" ]]; then
  echo "✗ node not found in PATH. Install Node.js via Homebrew: brew install node"
  exit 1
fi

BREW_BIN="$(dirname "$NODE")"
NEXT_BIN="$PROJECT_ROOT/frontend/node_modules/.bin/next"
HOME_DIR="$HOME"

echo "  python3 : $PYTHON3"
echo "  node    : $NODE"
echo "  brew_bin: $BREW_BIN"

# ─── Build frontend ───────────────────────────────────────────────────────────
echo ""
echo "⚙️  Building Next.js frontend..."
cd "$PROJECT_ROOT/frontend"
npm install --silent
npm run build
echo "✓ Frontend built"

# Verify .next exists
if [[ ! -d "$PROJECT_ROOT/frontend/.next" ]]; then
  echo "✗ frontend/.next not found after build"
  exit 1
fi

# ─── Read .env ────────────────────────────────────────────────────────────────
ENV_FILE="$PROJECT_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ .env not found at $ENV_FILE"
  exit 1
fi

# Extract values (strips comments, trims whitespace)
API_KEY="$(grep -E '^API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'\''[:space:]')"
BASE_URL="$(grep -E '^BASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'\''[:space:]')"
MODEL="$(grep -E '^MODEL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'\''[:space:]')"

if [[ -z "$API_KEY" || -z "$BASE_URL" || -z "$MODEL" ]]; then
  echo "✗ .env missing API_KEY, BASE_URL, or MODEL"
  exit 1
fi
echo "✓ .env loaded (API_KEY, BASE_URL, MODEL)"

# ─── Log directory ────────────────────────────────────────────────────────────
mkdir -p "$HOME_DIR/Library/Logs/TeachingLearning"
echo "✓ Log dir: $HOME_DIR/Library/Logs/TeachingLearning"

# ─── Install LaunchAgents ─────────────────────────────────────────────────────
LAUNCH_AGENTS_DIR="$HOME_DIR/Library/LaunchAgents"
mkdir -p "$LAUNCH_AGENTS_DIR"

install_agent() {
  local LABEL="$1"
  local TEMPLATE="$2"
  local DEST="$3"

  echo ""
  echo "🔧 Installing LaunchAgent: $LABEL"

  # Unload existing (ignore error on first run)
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

  # Instantiate template
  sed \
    -e "s|__PYTHON3__|$PYTHON3|g" \
    -e "s|__NODE__|$NODE|g" \
    -e "s|__NEXT_BIN__|$NEXT_BIN|g" \
    -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__BREW_BIN__|$BREW_BIN|g" \
    -e "s|__API_KEY__|$API_KEY|g" \
    -e "s|__BASE_URL__|$BASE_URL|g" \
    -e "s|__MODEL__|$MODEL|g" \
    -e "s|__HOME__|$HOME_DIR|g" \
    "$TEMPLATE" > "$DEST"

  plutil -lint "$DEST" || { echo "✗ Generated plist is invalid: $DEST"; exit 1; }
  launchctl bootstrap "gui/$(id -u)" "$DEST"
  echo "✓ $LABEL loaded"
}

install_agent \
  "com.teachinglearning.backend" \
  "$DESKTOP_DIR/launchagents/com.teachinglearning.backend.plist.template" \
  "$LAUNCH_AGENTS_DIR/com.teachinglearning.backend.plist"

install_agent \
  "com.teachinglearning.frontend" \
  "$DESKTOP_DIR/launchagents/com.teachinglearning.frontend.plist.template" \
  "$LAUNCH_AGENTS_DIR/com.teachinglearning.frontend.plist"

# ─── Build Swift .app ─────────────────────────────────────────────────────────
echo ""
echo "🔨 Building Swift .app..."

# Create bundle skeleton
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"
cp "$DESKTOP_DIR/TeachingLearning/Info.plist" "$APP_BUNDLE/Contents/"

SWIFT_SOURCES=(
  "$DESKTOP_DIR/TeachingLearning/main.swift"
  "$DESKTOP_DIR/TeachingLearning/ServiceManager.swift"
  "$DESKTOP_DIR/TeachingLearning/WebViewWindow.swift"
  "$DESKTOP_DIR/TeachingLearning/AppDelegate.swift"
)

if ! swiftc "${SWIFT_SOURCES[@]}" \
  -target arm64-apple-macos12.0 \
  -framework Cocoa \
  -framework WebKit \
  -o "$APP_BUNDLE/Contents/MacOS/TeachingLearning" 2>&1; then
  echo ""
  echo "✗ Swift compilation failed. Rolling back LaunchAgents..."
  launchctl bootout "gui/$(id -u)/com.teachinglearning.backend" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/com.teachinglearning.frontend" 2>/dev/null || true
  exit 1
fi

echo "✓ Swift compiled"

# ─── Install to ~/Applications ────────────────────────────────────────────────
INSTALL_PATH="$HOME_DIR/Applications/TeachingLearning.app"
rm -rf "$INSTALL_PATH"
cp -r "$APP_BUNDLE" "$INSTALL_PATH"

echo ""
echo "✅ Done!"
echo "   App installed: $INSTALL_PATH"
echo "   Backend:       http://127.0.0.1:8000"
echo "   Frontend:      http://127.0.0.1:3000"
echo ""
echo "   Open with: open ~/Applications/TeachingLearning.app"
