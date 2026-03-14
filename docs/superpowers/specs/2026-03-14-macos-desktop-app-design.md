# macOS Desktop App Design
**Date:** 2026-03-14
**Project:** Teaching-Learning- PPT 学习助手
**Approach:** Swift menubar app + macOS LaunchAgent

---

## 1. Goal

将现有 FastAPI + Next.js Web 项目打包为 macOS 桌面软件：
- 双击 `.app` 启动，原生窗口（WKWebView，无 URL 栏）
- 菜单栏图标控制服务
- 前后端作为 LaunchAgent 开机自启，与 App 生命周期解耦
- 现有代码零改动（除 `.env` CORS 配置收紧）

---

## 2. Architecture

```
TeachingLearning.app  (Swift, ~300 lines)
  └── WKWebView window → http://127.0.0.1:3000
  └── NSStatusItem menu bar icon (green/red health dot)
  └── On first launch: install LaunchAgents (frontend already built by build.sh)

macOS launchd (persistent, survives app quit and reboot)
  com.teachinglearning.backend  → /abs/path/python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
  com.teachinglearning.frontend → /abs/path/node /abs/path/next start --hostname 127.0.0.1 --port 3000

Project stays at: ~/github/Teaching-Learning-/
```

---

## 3. New Files

```
desktop/
├── TeachingLearning/
│   ├── AppDelegate.swift       ← app entry, NSStatusItem, LaunchAgent installer
│   ├── WebViewWindow.swift     ← WKWebView window, navigation delegate
│   ├── ServiceManager.swift    ← launchctl wrap, health check timer
│   └── Info.plist              ← see Section 5 for required keys
├── launchagents/
│   ├── com.teachinglearning.backend.plist.template
│   └── com.teachinglearning.frontend.plist.template
└── build.sh                    ← one-shot build + install script
```

---

## 4. Security

| Threat | Mitigation |
|--------|-----------|
| LAN access | Both services bind `127.0.0.1` only |
| CORS abuse | `.env` sets `CORS_ORIGINS=http://127.0.0.1:3000` (replaces `*`); `main.py` already reads this via `os.getenv("CORS_ORIGINS")` |
| API key exposure | `.env` stays in project dir; LaunchAgent `EnvironmentVariables` injects `API_KEY`, `BASE_URL`, `MODEL` at service startup |
| WKWebView plain HTTP | `Info.plist` includes `NSAppTransportSecurity` exception for `127.0.0.1` (ATS blocks http by default) |
| WKWebView navigation | Swift NavigationDelegate blocks all non-`127.0.0.1:3000` URLs; external links open via `NSWorkspace.shared.open()` |

---

## 5. Info.plist Required Keys

```xml
<key>CFBundleExecutable</key>      <string>TeachingLearning</string>
<key>CFBundleIdentifier</key>      <string>com.teachinglearning.app</string>
<key>CFBundleName</key>            <string>TeachingLearning</string>
<key>LSUIElement</key>             <true/>          <!-- suppress Dock icon (menubar-only) -->
<key>NSHighResolutionCapable</key> <true/>
<key>LSMinimumSystemVersion</key>  <string>12.0</string>
<key>NSAppTransportSecurity</key>
  <dict>
    <key>NSExceptionDomains</key>
    <dict>
      <key>127.0.0.1</key>
      <dict>
        <key>NSExceptionAllowsInsecureHTTPLoads</key> <true/>
        <key>NSIncludesSubdomains</key>               <false/>
      </dict>
    </dict>
  </dict>
```

---

## 6. Concurrency

| Layer | Status |
|-------|--------|
| FastAPI | async uvicorn, adequate for single-user desktop |
| SQLite | session-per-request already correct; `check_same_thread=False` already set |
| File processing | synchronous pymupdf acceptable for single-user |
| Next.js | `next start` multi-threaded, no changes needed |

---

## 7. LaunchAgent Configuration

Both plists use:
- `KeepAlive = true` — auto-restart on crash
- `ThrottleInterval = 10` — 10s cooldown before restart
- `StandardOutPath` / `StandardErrorPath` → `~/Library/Logs/TeachingLearning/`
- `EnvironmentVariables` — absolute PATH (resolved by `build.sh` at install time), plus service-specific vars (below)
- `WorkingDirectory` — absolute path to `backend/` or `frontend/`
- **`ProgramArguments` uses absolute paths** (no shell expansion, launchd does not invoke a shell)

### Backend plist (template, paths filled by build.sh)

```xml
<key>ProgramArguments</key>
<array>
  <string>__PYTHON3__</string>       <!-- e.g. /opt/homebrew/bin/python3 -->
  <string>-m</string>
  <string>uvicorn</string>
  <string>app.main:app</string>
  <string>--host</string><string>127.0.0.1</string>
  <string>--port</string><string>8000</string>
</array>
<key>WorkingDirectory</key>
<string>__PROJECT_ROOT__/backend</string>
<key>EnvironmentVariables</key>
<dict>
  <key>PATH</key>       <string>__BREW_BIN__:/usr/bin:/bin</string>
  <key>PYTHONPATH</key> <string>__PROJECT_ROOT__/backend</string>
  <key>API_KEY</key>    <string>__API_KEY__</string>
  <key>BASE_URL</key>   <string>__BASE_URL__</string>
  <key>MODEL</key>      <string>__MODEL__</string>
</dict>
```

### Frontend plist (template)

```xml
<key>ProgramArguments</key>
<array>
  <string>__NODE__</string>           <!-- e.g. /opt/homebrew/bin/node -->
  <string>__NEXT_BIN__</string>       <!-- e.g. /path/frontend/node_modules/.bin/next -->
  <string>start</string>
  <string>--hostname</string><string>127.0.0.1</string>
  <string>--port</string><string>3000</string>
</array>
<key>WorkingDirectory</key>
<string>__PROJECT_ROOT__/frontend</string>
<key>EnvironmentVariables</key>
<dict>
  <key>PATH</key>       <string>__BREW_BIN__:/usr/bin:/bin</string>
  <key>NODE_ENV</key>   <string>production</string>
</dict>
```

---

## 8. build.sh

`build.sh` runs once (and again after code changes). It:
1. Resolves all absolute paths for Python, Node, Homebrew bin, Next binary
2. Builds Next.js (`npm run build`) — this is the single authoritative build step
3. Reads `.env` to extract `API_KEY`, `BASE_URL`, `MODEL`
4. Instantiates plist templates → writes to `~/Library/LaunchAgents/`
5. Creates `~/Library/Logs/TeachingLearning/`
6. Handles re-runs: `launchctl bootout gui/$UID/<label>` (ignore error) before `launchctl bootstrap gui/$UID <plist>`
7. Creates `.app` bundle skeleton (`mkdir -p Contents/MacOS Contents/Resources`)
8. Compiles Swift with `swiftc -target arm64-apple-macos12.0 -framework Cocoa -framework WebKit`
9. Copies `Info.plist` into bundle
10. Installs to `~/Applications/TeachingLearning.app`

```bash
#!/bin/bash
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/desktop"

# --- Resolve toolchain paths ---
PYTHON3="$PROJECT_ROOT/backend/.venv/bin/python3"   # always use venv Python
NODE="$(which node)"
BREW_BIN="$(dirname "$NODE")"
NEXT_BIN="$PROJECT_ROOT/frontend/node_modules/.bin/next"

# --- Build frontend (authoritative build step) ---
cd "$PROJECT_ROOT/frontend"
npm install --silent
npm run build

# --- Read .env ---
source <(grep -E '^(API_KEY|BASE_URL|MODEL)=' "$PROJECT_ROOT/.env" | sed 's/^/export /')

# --- Create log dir ---
mkdir -p ~/Library/Logs/TeachingLearning

# --- Install LaunchAgents (handle re-run gracefully) ---
install_agent() {
  local LABEL="$1" PLIST_SRC="$2" PLIST_DEST="$3"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  sed \
    -e "s|__PYTHON3__|$PYTHON3|g" \
    -e "s|__NODE__|$NODE|g" \
    -e "s|__NEXT_BIN__|$NEXT_BIN|g" \
    -e "s|__PROJECT_ROOT__|$PROJECT_ROOT|g" \
    -e "s|__BREW_BIN__|$BREW_BIN|g" \
    -e "s|__API_KEY__|$API_KEY|g" \
    -e "s|__BASE_URL__|$BASE_URL|g" \
    -e "s|__MODEL__|$MODEL|g" \
    "$PLIST_SRC" > "$PLIST_DEST"
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
}

install_agent \
  "com.teachinglearning.backend" \
  "$DESKTOP_DIR/launchagents/com.teachinglearning.backend.plist.template" \
  ~/Library/LaunchAgents/com.teachinglearning.backend.plist

install_agent \
  "com.teachinglearning.frontend" \
  "$DESKTOP_DIR/launchagents/com.teachinglearning.frontend.plist.template" \
  ~/Library/LaunchAgents/com.teachinglearning.frontend.plist

# --- Build Swift .app ---
APP_BUNDLE="$DESKTOP_DIR/TeachingLearning.app"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"
cp "$DESKTOP_DIR/TeachingLearning/Info.plist" "$APP_BUNDLE/Contents/"

if ! swiftc $DESKTOP_DIR/TeachingLearning/*.swift \
  -target arm64-apple-macos12.0 \
  -framework Cocoa -framework WebKit \
  -o "$APP_BUNDLE/Contents/MacOS/TeachingLearning"; then
  echo "✗ Swift compilation failed. Rolling back LaunchAgents..."
  launchctl bootout "gui/$(id -u)/com.teachinglearning.backend" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/com.teachinglearning.frontend" 2>/dev/null || true
  exit 1
fi

# --- Install ---
cp -r "$APP_BUNDLE" ~/Applications/TeachingLearning.app
echo "✓ Done. Open ~/Applications/TeachingLearning.app"
```

---

## 9. Swift App Behavior

### First Launch
1. Swift app starts; services are already running (LaunchAgents started by `build.sh`)
2. Poll `GET http://127.0.0.1:8000/health` with 1s `URLSession` timeout, up to 30 retries (30s total)
3. If all 30 retries fail → show error dialog: "Backend service failed to start. Check logs via the menu bar icon." (Do NOT attempt port-occupancy detection separately — health polling is the single source of truth for service readiness.)
4. Load `http://127.0.0.1:3000` in WKWebView once health check returns 200

### Menu Bar Icon
- Green dot (●): both `/health` (8000) and `GET http://127.0.0.1:3000` return 200
- Red dot (●): any service unreachable (health check every 5s with 1s timeout per request)
- Menu items:
  - **打开学习助手** — show/focus WKWebView window
  - **重启服务** — show confirmation alert → `launchctl kickstart -k gui/$UID/com.teachinglearning.backend` + frontend
  - **开机自启 ✓** — toggle `Disabled` key in both plists + `launchctl enable/disable`
  - **查看日志** — open log folder via `FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/TeachingLearning")` passed to `NSWorkspace.shared.open(_:)` (tilde must be expanded; do NOT pass raw `~` string)
  - **退出 App** — `NSApp.terminate(nil)`; services keep running

### WKWebView Window
- Style: titled, closable, resizable; no URL bar
- Navigation delegate: allow `127.0.0.1:3000/*` and `127.0.0.1:8000/storage/*`; redirect all others to system browser
- On window close: `orderOut` (hide), do not stop services
- Health-check `URLSession` uses `timeoutIntervalForRequest = 1.0` to prevent queue buildup

---

## 10. Code Changes to Existing Project

| File | Change |
|------|--------|
| `.env` | Add `CORS_ORIGINS=http://127.0.0.1:3000` |
| `backend/app/main.py` | No change (already reads `CORS_ORIGINS` from env) |
| `frontend/package.json` | No change |
| All other files | No change |

---

## 11. Out of Scope

- Code signing / notarization (deferred)
- Auto-update mechanism
- Multiple user accounts
- Intel (x86_64) Mac support — `build.sh` targets `arm64-apple-macos12.0`; can be extended to universal binary later
