# macOS Desktop App Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 FastAPI + Next.js 项目打包为原生 macOS 桌面软件（Swift menubar app + LaunchAgent 持久后台服务）。

**Architecture:** Swift menubar app 作为控制面板，两个 LaunchAgent 分别运行 uvicorn(8000) 和 next start(3000)，均绑定 127.0.0.1。WKWebView 窗口显示前端页面，无 URL 栏。`build.sh` 一键完成构建和安装。

**Tech Stack:** Swift 5 + AppKit + WebKit, swiftc (command-line), launchd LaunchAgents, FastAPI/uvicorn, Next.js 15

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `desktop/build.sh` | Create | 一键构建脚本：构建前端、安装 LaunchAgent、编译 Swift .app |
| `desktop/TeachingLearning/Info.plist` | Create | .app bundle 元数据（LSUIElement, ATS, CFBundle*） |
| `desktop/TeachingLearning/main.swift` | Create | App 入口：初始化 NSApplication，设置 menubar-only policy |
| `desktop/TeachingLearning/AppDelegate.swift` | Create | NSStatusItem 菜单栏图标，首次启动逻辑，健康状态图标 |
| `desktop/TeachingLearning/WebViewWindow.swift` | Create | WKWebView 窗口，NavigationDelegate（拦截外部链接） |
| `desktop/TeachingLearning/ServiceManager.swift` | Create | launchctl 封装，health check timer，waitForBackend |
| `desktop/launchagents/com.teachinglearning.backend.plist.template` | Create | backend LaunchAgent plist 模板 |
| `desktop/launchagents/com.teachinglearning.frontend.plist.template` | Create | frontend LaunchAgent plist 模板 |
| `.env` | Modify | 追加 `CORS_ORIGINS=http://127.0.0.1:3000` |

---

## Chunk 1: 静态文件 — 目录、plist 模板、Info.plist、.env

### Task 1: 创建目录结构

- [ ] **Step 1: 创建所有目录**

```bash
mkdir -p /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning
mkdir -p /Users/shihaochen/github/Teaching-Learning-/desktop/launchagents
```

- [ ] **Step 2: 验证目录存在**

```bash
ls /Users/shihaochen/github/Teaching-Learning-/desktop/
```

Expected output:
```
TeachingLearning/   launchagents/
```

---

### Task 2: 写 Info.plist

- [ ] **Step 1: 创建文件 `desktop/TeachingLearning/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>TeachingLearning</string>
  <key>CFBundleIdentifier</key>
  <string>com.teachinglearning.app</string>
  <key>CFBundleName</key>
  <string>TeachingLearning</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSExceptionDomains</key>
    <dict>
      <key>127.0.0.1</key>
      <dict>
        <key>NSExceptionAllowsInsecureHTTPLoads</key>
        <true/>
        <key>NSIncludesSubdomains</key>
        <false/>
      </dict>
    </dict>
  </dict>
</dict>
</plist>
```

- [ ] **Step 2: 验证 plist 合法**

```bash
plutil -lint /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning/Info.plist
```

Expected: `Info.plist: OK`

---

### Task 3: 写 backend LaunchAgent 模板

- [ ] **Step 1: 创建 `desktop/launchagents/com.teachinglearning.backend.plist.template`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.teachinglearning.backend</string>

  <key>ProgramArguments</key>
  <array>
    <string>__PYTHON3__</string>
    <string>-m</string>
    <string>uvicorn</string>
    <string>app.main:app</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>8000</string>
  </array>

  <key>WorkingDirectory</key>
  <string>__PROJECT_ROOT__/backend</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>__BREW_BIN__:/usr/bin:/bin</string>
    <key>PYTHONPATH</key>
    <string>__PROJECT_ROOT__/backend</string>
    <key>API_KEY</key>
    <string>__API_KEY__</string>
    <key>BASE_URL</key>
    <string>__BASE_URL__</string>
    <key>MODEL</key>
    <string>__MODEL__</string>
    <key>CORS_ORIGINS</key>
    <string>http://127.0.0.1:3000</string>
  </dict>

  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>__HOME__/Library/Logs/TeachingLearning/backend.log</string>
  <key>StandardErrorPath</key>
  <string>__HOME__/Library/Logs/TeachingLearning/backend.err</string>
</dict>
</plist>
```

---

### Task 4: 写 frontend LaunchAgent 模板

- [ ] **Step 1: 创建 `desktop/launchagents/com.teachinglearning.frontend.plist.template`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.teachinglearning.frontend</string>

  <key>ProgramArguments</key>
  <array>
    <string>__NODE__</string>
    <string>__NEXT_BIN__</string>
    <string>start</string>
    <string>--hostname</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>3000</string>
  </array>

  <key>WorkingDirectory</key>
  <string>__PROJECT_ROOT__/frontend</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>__BREW_BIN__:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>__HOME__/Library/Logs/TeachingLearning/frontend.log</string>
  <key>StandardErrorPath</key>
  <string>__HOME__/Library/Logs/TeachingLearning/frontend.err</string>
</dict>
</plist>
```

---

### Task 5: 更新 .env

- [ ] **Step 1: 检查 .env 是否已有 CORS_ORIGINS**

```bash
grep CORS_ORIGINS /Users/shihaochen/github/Teaching-Learning-/.env || echo "NOT FOUND"
```

- [ ] **Step 2: 若不存在，追加**

```bash
echo "CORS_ORIGINS=http://127.0.0.1:3000" >> /Users/shihaochen/github/Teaching-Learning-/.env
```

- [ ] **Step 3: 验证**

```bash
grep CORS_ORIGINS /Users/shihaochen/github/Teaching-Learning-/.env
```

Expected: `CORS_ORIGINS=http://127.0.0.1:3000`

- [ ] **Step 4: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add desktop/ .env
git commit -m "feat: scaffold desktop app static files and LaunchAgent templates"
```

---

## Chunk 2: build.sh

### Task 6: 写 build.sh

- [ ] **Step 1: 创建 `desktop/build.sh`**

```bash
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
```

- [ ] **Step 2: 赋予可执行权限**

```bash
chmod +x /Users/shihaochen/github/Teaching-Learning-/desktop/build.sh
```

- [ ] **Step 3: 空运行验证（只检查语法，不实际执行）**

```bash
bash -n /Users/shihaochen/github/Teaching-Learning-/desktop/build.sh && echo "Syntax OK"
```

Expected: `Syntax OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add desktop/build.sh
git commit -m "feat: add desktop build.sh with LaunchAgent install and Swift compilation"
```

---

## Chunk 3: Swift 源文件

### Task 7: 写 ServiceManager.swift

ServiceManager 封装所有 launchctl 调用和 health check 逻辑，与 UI 层解耦。

- [ ] **Step 1: 创建 `desktop/TeachingLearning/ServiceManager.swift`**

```swift
import Foundation
import Cocoa

/// Manages LaunchAgent lifecycle and health monitoring.
class ServiceManager {
    static let shared = ServiceManager()

    private let backendLabel = "com.teachinglearning.backend"
    private let frontendLabel = "com.teachinglearning.frontend"
    private var healthTimer: Timer?

    /// Called on main thread with current health status (true = both services OK).
    var onHealthChanged: ((Bool) -> Void)?

    private init() {}

    // MARK: - Service Control

    /// Forcefully restarts both services via launchctl kickstart -k.
    /// Completion is called on main thread after a 2s warm-up delay.
    func restartServices(completion: @escaping () -> Void) {
        let uid = getuid()
        DispatchQueue.global(qos: .userInitiated).async {
            self.runLaunchctl(["kickstart", "-k", "gui/\(uid)/\(self.backendLabel)"])
            self.runLaunchctl(["kickstart", "-k", "gui/\(uid)/\(self.frontendLabel)"])
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: completion)
        }
    }

    /// Toggles autostart for both LaunchAgents.
    func setAutostart(enabled: Bool) {
        let uid = getuid()
        let verb = enabled ? "enable" : "disable"
        DispatchQueue.global(qos: .background).async {
            self.runLaunchctl([verb, "gui/\(uid)/\(self.backendLabel)"])
            self.runLaunchctl([verb, "gui/\(uid)/\(self.frontendLabel)"])
        }
    }

    /// Opens the log directory in Finder.
    func openLogs() {
        let logsURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/TeachingLearning")
        NSWorkspace.shared.open(logsURL)
    }

    // MARK: - Health Check

    /// Starts periodic health checks every 5 seconds.
    func startHealthChecks() {
        // Immediate check, then every 5s
        performHealthCheck()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.performHealthCheck()
        }
    }

    func stopHealthChecks() {
        healthTimer?.invalidate()
        healthTimer = nil
    }

    private func performHealthCheck() {
        let session = makeEphemeralSession(timeout: 1.0)
        let group = DispatchGroup()
        var backendOK = false
        var frontendOK = false

        group.enter()
        session.dataTask(with: URL(string: "http://127.0.0.1:8000/health")!) { _, resp, _ in
            backendOK = (resp as? HTTPURLResponse)?.statusCode == 200
            group.leave()
        }.resume()

        group.enter()
        session.dataTask(with: URL(string: "http://127.0.0.1:3000")!) { _, resp, _ in
            frontendOK = (resp as? HTTPURLResponse)?.statusCode == 200
            group.leave()
        }.resume()

        group.notify(queue: .main) { [weak self] in
            self?.onHealthChanged?(backendOK && frontendOK)
        }
    }

    // MARK: - Wait for Backend

    /// Polls backend /health until 200 or maxRetries exhausted.
    /// Completion is called on main thread.
    func waitForBackend(maxRetries: Int = 30, completion: @escaping (_ success: Bool) -> Void) {
        pollBackend(attempt: 0, maxRetries: maxRetries, completion: completion)
    }

    private func pollBackend(attempt: Int, maxRetries: Int, completion: @escaping (Bool) -> Void) {
        if attempt >= maxRetries {
            DispatchQueue.main.async { completion(false) }
            return
        }
        let session = makeEphemeralSession(timeout: 1.0)
        session.dataTask(with: URL(string: "http://127.0.0.1:8000/health")!) { [weak self] _, resp, _ in
            if (resp as? HTTPURLResponse)?.statusCode == 200 {
                DispatchQueue.main.async { completion(true) }
            } else {
                // No extra wait — each attempt already blocks up to 1s via request timeout.
                // 30 retries × 1s = ~30s worst-case total.
                DispatchQueue.global().async {
                    self?.pollBackend(attempt: attempt + 1, maxRetries: maxRetries, completion: completion)
                }
            }
        }.resume()
    }

    // MARK: - Helpers

    @discardableResult
    private func runLaunchctl(_ args: [String]) -> Bool {
        let task = Process()
        task.launchPath = "/bin/launchctl"
        task.arguments = args
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        try? task.run()
        task.waitUntilExit()
        return task.terminationStatus == 0
    }

    private func makeEphemeralSession(timeout: TimeInterval) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout
        return URLSession(configuration: config)
    }
}
```

- [ ] **Step 2: 编译验证（单文件，检查语法）**

```bash
swiftc -parse /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning/ServiceManager.swift \
  -framework Foundation && echo "Parse OK"
```

Expected: `Parse OK`

---

### Task 8: 写 WebViewWindow.swift

- [ ] **Step 1: 创建 `desktop/TeachingLearning/WebViewWindow.swift`**

```swift
import Cocoa
import WebKit

/// Full-window WKWebView without URL bar.
/// Hides on close (does not terminate services).
class WebViewWindow: NSWindow {
    private var webView: WKWebView!

    override init(
        contentRect: NSRect,
        styleMask: NSWindow.StyleMask,
        backing: NSWindow.BackingStoreType,
        defer flag: Bool
    ) {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 800),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        setup()
    }

    private func setup() {
        title = "学习助手"
        isReleasedWhenClosed = false
        center()

        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        contentView = webView
    }

    /// Loads the frontend. Call only after backend health check passes.
    func loadApp() {
        let request = URLRequest(
            url: URL(string: "http://127.0.0.1:3000")!,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        webView.load(request)
    }

    /// Reload current page (e.g. after service restart).
    func reload() {
        webView.reload()
    }

    // Hide window on close; do NOT stop services.
    override func close() {
        orderOut(nil)
    }
}

// MARK: - WKNavigationDelegate

extension WebViewWindow: WKNavigationDelegate {

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        let host = url.host ?? ""
        let port = url.port

        // Allow our services: frontend (3000) and backend static (8000)
        if host == "127.0.0.1" && (port == 3000 || port == 8000) {
            decisionHandler(.allow)
            return
        }

        // Allow about: scheme (initial empty page)
        if url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        // Redirect all external navigation to system browser
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError error: Error) {
        // Silently ignore provisional load failures (service may still be starting)
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled { return }
        print("[WebView] provisional load failed: \(error.localizedDescription)")
    }
}
```

- [ ] **Step 2: 编译验证**

```bash
swiftc -parse \
  /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning/ServiceManager.swift \
  /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning/WebViewWindow.swift \
  -framework Foundation -framework Cocoa -framework WebKit && echo "Parse OK"
```

Expected: `Parse OK`

---

### Task 9: 写 AppDelegate.swift 和 main.swift

- [ ] **Step 1: 创建 `desktop/TeachingLearning/AppDelegate.swift`**

```swift
import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var window: WebViewWindow!
    private var isHealthy = false
    private var autostartEnabled = true

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Read actual autostart state from launchd
        autostartEnabled = isLaunchAgentEnabled()
        // Menubar-only: suppress Dock icon in code as well
        NSApp.setActivationPolicy(.accessory)

        window = WebViewWindow(
            contentRect: .zero,
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )

        setupStatusItem()

        // Subscribe to health updates
        ServiceManager.shared.onHealthChanged = { [weak self] healthy in
            self?.isHealthy = healthy
            self?.updateStatusDot()
        }

        // Wait for backend → load UI → start periodic health checks
        ServiceManager.shared.waitForBackend { [weak self] success in
            guard let self = self else { return }
            if success {
                self.window.loadApp()
                self.window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
                ServiceManager.shared.startHealthChecks()
            } else {
                self.showStartupError()
            }
        }
    }

    // MARK: - Status Item

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateStatusDot()

        let menu = NSMenu()

        let openItem = NSMenuItem(title: "打开学习助手", action: #selector(showWindow), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)

        menu.addItem(.separator())

        let restartItem = NSMenuItem(title: "重启服务", action: #selector(restartServices), keyEquivalent: "")
        restartItem.target = self
        menu.addItem(restartItem)

        let autostartItem = NSMenuItem(title: "开机自启 ✓", action: #selector(toggleAutostart), keyEquivalent: "")
        autostartItem.target = self
        autostartItem.tag = 100  // used to find and update checkmark
        menu.addItem(autostartItem)

        let logsItem = NSMenuItem(title: "查看日志", action: #selector(openLogs), keyEquivalent: "")
        logsItem.target = self
        menu.addItem(logsItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "退出 App（服务继续运行）", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func updateStatusDot() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let color: NSColor = self.isHealthy ? .systemGreen : .systemRed
            let attrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: color,
                .font: NSFont.systemFont(ofSize: 16, weight: .bold)
            ]
            self.statusItem.button?.attributedTitle = NSAttributedString(string: "●", attributes: attrs)
        }
    }

    // MARK: - Actions

    @objc private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func restartServices() {
        let alert = NSAlert()
        alert.messageText = "重启服务"
        alert.informativeText = "将强制重启后端和前端服务，进行中的操作可能丢失。确认？"
        alert.addButton(withTitle: "重启")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        isHealthy = false
        updateStatusDot()

        ServiceManager.shared.restartServices { [weak self] in
            ServiceManager.shared.waitForBackend { success in
                if success {
                    self?.window.loadApp()
                }
            }
        }
    }

    @objc private func toggleAutostart(_ sender: NSMenuItem) {
        autostartEnabled.toggle()
        sender.title = autostartEnabled ? "开机自启 ✓" : "开机自启"
        ServiceManager.shared.setAutostart(enabled: autostartEnabled)
    }

    @objc private func openLogs() {
        ServiceManager.shared.openLogs()
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    // MARK: - Autostart State

    /// Returns true if backend LaunchAgent is currently enabled in launchd.
    private func isLaunchAgentEnabled() -> Bool {
        let task = Process()
        task.launchPath = "/bin/launchctl"
        task.arguments = ["is-enabled", "gui/\(getuid())/com.teachinglearning.backend"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        try? task.run()
        task.waitUntilExit()
        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return output.trimmingCharacters(in: .whitespacesAndNewlines) == "enabled"
    }

    // MARK: - Error Handling

    private func showStartupError() {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "服务启动失败"
        alert.informativeText = "后端服务在 30 秒内未就绪。\n\n请通过菜单栏图标 → 查看日志 排查原因，然后点击"重启服务"重试。"
        alert.addButton(withTitle: "好")
        alert.runModal()
    }
}
```

- [ ] **Step 2: 创建 `desktop/TeachingLearning/main.swift`**

```swift
import Cocoa

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
```

- [ ] **Step 3: 编译所有 Swift 文件（集成语法检查）**

```bash
swiftc -parse \
  /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning/main.swift \
  /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning/ServiceManager.swift \
  /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning/WebViewWindow.swift \
  /Users/shihaochen/github/Teaching-Learning-/desktop/TeachingLearning/AppDelegate.swift \
  -framework Cocoa -framework WebKit -framework Foundation && echo "All files parse OK"
```

Expected: `All files parse OK`（parse 阶段不需要 framework 实际存在，仅检查语法）

- [ ] **Step 4: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add desktop/TeachingLearning/
git commit -m "feat: add Swift app source (AppDelegate, WebViewWindow, ServiceManager, main)"
```

---

## Chunk 4: 集成测试 — 运行 build.sh 验证完整流程

### Task 10: 执行 build.sh

- [ ] **Step 1: 停掉当前已在运行的服务（避免端口冲突）**

```bash
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
```

- [ ] **Step 2: 卸载旧的 LaunchAgents（如有）**

```bash
launchctl bootout "gui/$(id -u)/com.teachinglearning.backend" 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.teachinglearning.frontend" 2>/dev/null || true
```

- [ ] **Step 3: 运行 build.sh**

```bash
cd /Users/shihaochen/github/Teaching-Learning-/desktop
bash build.sh
```

Expected final lines:
```
✅ Done!
   App installed: /Users/shihaochen/Applications/TeachingLearning.app
   Backend:       http://127.0.0.1:8000
   Frontend:      http://127.0.0.1:3000
```

若失败，查看错误信息，常见原因：
- `swiftc: command not found` → 需要安装 Xcode Command Line Tools: `xcode-select --install`
- `frontend build failed` → 检查 `frontend/` node_modules: `cd frontend && npm install`
- `venv Python not found` → `cd backend && pip install -e '.[dev]'` 或 `python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`

- [ ] **Step 4: 验证 LaunchAgents 已加载**

```bash
launchctl list | grep teachinglearning
```

Expected（两行，PID 非 `-`）:
```
12345   0   com.teachinglearning.backend
12346   0   com.teachinglearning.frontend
```

- [ ] **Step 5: 验证后端健康**

```bash
sleep 5 && curl -s http://127.0.0.1:8000/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 6: 验证前端响应**

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000
```

Expected: `200`

- [ ] **Step 7: 验证生成的 plist 正确（无模板占位符残留）**

```bash
grep "__" ~/Library/LaunchAgents/com.teachinglearning.backend.plist && echo "PLACEHOLDER FOUND - ERROR" || echo "No placeholders - OK"
grep "__" ~/Library/LaunchAgents/com.teachinglearning.frontend.plist && echo "PLACEHOLDER FOUND - ERROR" || echo "No placeholders - OK"
```

Expected: 两行均显示 `No placeholders - OK`

---

### Task 11: 启动并验证 .app

- [ ] **Step 1: 启动 App**

```bash
open ~/Applications/TeachingLearning.app
```

- [ ] **Step 2: 手动验证清单**

验证以下行为（目视检查）：

| 检查项 | 预期行为 |
|--------|---------|
| Dock | App 不出现在 Dock 中 |
| 菜单栏 | 右上角出现 ● 图标（绿色） |
| 点击 "打开学习助手" | 弹出无 URL 栏的原生窗口，加载学习助手界面 |
| 关闭窗口 | 窗口消失，菜单栏图标仍在，服务继续运行 |
| 再次点击 "打开学习助手" | 窗口重新出现 |
| 外部链接 | 点击界面内的外部链接，在系统浏览器打开 |
| 菜单 "查看日志" | 打开 `~/Library/Logs/TeachingLearning/` 文件夹 |
| 菜单 "退出 App" | App 退出，但服务仍在运行（`launchctl list \| grep teachinglearning` 仍有输出） |
| 重启 Mac 后 | 服务自动重启（等待开机后约 15 秒执行 `curl http://127.0.0.1:8000/health`） |

- [ ] **Step 3: 验证 CORS 锁定生效**

```bash
# 模拟来自非授权 origin 的请求，应被拒绝（或被允许，视 FastAPI CORS 配置）
curl -s -H "Origin: http://malicious.local" http://127.0.0.1:8000/health -i | grep -i "access-control"
```

Expected: 不返回 `Access-Control-Allow-Origin: *`（仅 `http://127.0.0.1:3000` 被允许）

- [ ] **Step 4: 最终 Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add -A
git commit -m "feat: complete macOS desktop app (Swift menubar + LaunchAgent)"
```

---

## 更新流程（代码改动后）

```bash
cd ~/github/Teaching-Learning-/desktop
./build.sh   # 重新构建前端 + 重装 LaunchAgent + 重编译 Swift app
```

无需任何手动步骤。

---

## 卸载

```bash
launchctl bootout "gui/$(id -u)/com.teachinglearning.backend"
launchctl bootout "gui/$(id -u)/com.teachinglearning.frontend"
rm ~/Library/LaunchAgents/com.teachinglearning.backend.plist
rm ~/Library/LaunchAgents/com.teachinglearning.frontend.plist
rm -rf ~/Applications/TeachingLearning.app
```
