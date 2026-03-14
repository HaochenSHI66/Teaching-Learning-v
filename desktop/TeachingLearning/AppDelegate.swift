import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var window: WebViewWindow!
    private var isHealthy = false
    private var autostartEnabled = true

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Menubar-only: suppress Dock icon in code as well
        NSApp.setActivationPolicy(.accessory)

        // Read actual autostart state from launchd
        autostartEnabled = isLaunchAgentEnabled()

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

        let autostartItem = NSMenuItem(title: autostartEnabled ? "开机自启 ✓" : "开机自启", action: #selector(toggleAutostart(_:)), keyEquivalent: "")
        autostartItem.target = self
        autostartItem.tag = 100
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
        alert.informativeText = "后端服务在 30 秒内未就绪。\n\n请通过菜单栏图标 → 查看日志 排查原因，然后点击\u{201C}重启服务\u{201D}重试。"
        alert.addButton(withTitle: "好")
        alert.runModal()
    }
}
