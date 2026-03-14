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
  └── On first launch: build frontend + install LaunchAgents

macOS launchd (persistent, survives app quit and reboot)
  com.teachinglearning.backend  → uvicorn --host 127.0.0.1 --port 8000
  com.teachinglearning.frontend → next start --hostname 127.0.0.1 --port 3000

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
│   └── Info.plist
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
| CORS abuse | `.env` sets `CORS_ORIGINS=http://127.0.0.1:3000` (replaces `*`) |
| API key exposure | `.env` stays in project dir, injected via LaunchAgent `EnvironmentVariables` |
| WKWebView navigation | Swift NavigationDelegate blocks all non-`127.0.0.1:3000` URLs; external links open in system browser |

---

## 5. Concurrency

| Layer | Status |
|-------|--------|
| FastAPI | async uvicorn, adequate for single-user desktop |
| SQLite | session-per-request already correct; `check_same_thread=False` already set |
| File processing | synchronous pymupdf acceptable for single-user |
| Next.js | `next start` multi-threaded, no changes needed |

---

## 6. LaunchAgent Configuration

Both plists use:
- `KeepAlive = true` — auto-restart on crash
- `ThrottleInterval = 10` — 10s cooldown before restart
- `StandardOutPath` / `StandardErrorPath` → `~/Library/Logs/TeachingLearning/`
- `EnvironmentVariables` — injects `PATH`, `API_KEY`, `BASE_URL`, `MODEL` from `.env`
- `WorkingDirectory` → project root (`~/github/Teaching-Learning-/backend` or `frontend`)

---

## 7. Swift App Behavior

### First Launch
1. Check if `frontend/.next` exists; if not, show progress sheet and run `npm run build`
2. Write LaunchAgent plists to `~/Library/LaunchAgents/`
3. `launchctl bootstrap gui/$UID <plist>` to start services
4. Wait for `GET /health` → 200 before loading WKWebView

### Menu Bar Icon
- Green dot: both services healthy
- Red dot: one or more services unreachable (health check every 5s)
- Menu items:
  - **打开学习助手** — show/focus WKWebView window
  - **重启服务** — `launchctl kickstart -k` both agents
  - **开机自启 ✓** — toggle `Disabled` key in plist
  - **查看日志** — open `~/Library/Logs/TeachingLearning/` in Finder
  - **退出 App** — terminate Swift process only; services keep running

### WKWebView Window
- `NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable`
- No URL bar; title bar shows app name only
- `WKWebView` fills entire window
- Navigation delegate: allow only `127.0.0.1:3000/*` and `127.0.0.1:8000/storage/*`; redirect all other URLs to `NSWorkspace.shared.open()`
- On window close: hide window (do not terminate services)

---

## 8. Build & Install

### `desktop/build.sh`
```bash
#!/bin/bash
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Build Next.js
cd "$PROJECT_ROOT/frontend"
npm install
npm run build

# 2. Compile Swift app
cd "$PROJECT_ROOT/desktop"
swiftc TeachingLearning/*.swift \
  -o TeachingLearning.app/Contents/MacOS/TeachingLearning \
  -framework Cocoa -framework WebKit

# 3. Install to ~/Applications
cp -r TeachingLearning.app ~/Applications/TeachingLearning.app
echo "Done. Launch ~/Applications/TeachingLearning.app"
```

### One-time setup
```bash
cd ~/github/Teaching-Learning-/desktop
chmod +x build.sh && ./build.sh
open ~/Applications/TeachingLearning.app
```

### Updates
Re-run `./build.sh` after code changes. LaunchAgents auto-reload on next service restart.

---

## 9. Code Changes to Existing Project

| File | Change |
|------|--------|
| `.env` | Add `CORS_ORIGINS=http://127.0.0.1:3000` |
| `backend/app/main.py` | No change |
| `frontend/package.json` | No change |
| All other files | No change |

---

## 10. Out of Scope

- Code signing / notarization (deferred to later distribution need)
- Auto-update mechanism
- Multiple user accounts
- Vector DB / embedding RAG (existing project scope note)
