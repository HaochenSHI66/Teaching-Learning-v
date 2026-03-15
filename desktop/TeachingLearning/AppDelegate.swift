import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var window: WebViewWindow!
    private var isHealthy = false
    private var autostartEnabled = true

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)

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

        // Show window immediately with loading screen
        window.showLoading(message: "正在启动服务...")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // Ensure services are bootstrapped and running, then wait for backend
        ServiceManager.shared.ensureServicesRunning(autostartEnabled: autostartEnabled) {
            self.window.updateLoadingStatus("服务已启动，等待后端就绪...")
            ServiceManager.shared.waitForBackend { [weak self] success in
                guard let self = self else { return }
                if success {
                    self.window.updateLoadingStatus("加载中...")
                    self.window.loadApp()
                    ServiceManager.shared.startHealthChecks()
                } else {
                    self.showStartupError()
                }
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

        let quitItem = NSMenuItem(title: "退出", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func updateStatusDot() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let button = self.statusItem.button else { return }

            // Load AppIcon.icns from bundle Resources
            let iconPath = Bundle.main.resourcePath.map { $0 + "/AppIcon.icns" } ?? ""
            if let appIcon = NSImage(contentsOfFile: iconPath) {
                appIcon.size = NSSize(width: 18, height: 18)
                appIcon.isTemplate = false
                button.image = appIcon
                button.imageScaling = .scaleProportionallyUpOrDown
                button.title = ""
                button.attributedTitle = NSAttributedString(string: "")
            }
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
        ServiceManager.shared.stopHealthChecks()
        ServiceManager.shared.stopServices()
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
        alert.messageText = "服务启动超时"
        alert.informativeText = "后端服务未能在预期时间内就绪，请重试。"
        alert.addButton(withTitle: "重试")
        alert.addButton(withTitle: "退出")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            window.updateLoadingStatus("正在重试...")
            ServiceManager.shared.ensureServicesRunning(autostartEnabled: autostartEnabled) {
                ServiceManager.shared.waitForBackend { [weak self] success in
                    guard let self = self else { return }
                    if success {
                        self.window.updateLoadingStatus("加载中...")
                        self.window.loadApp()
                        ServiceManager.shared.startHealthChecks()
                    } else {
                        self.showStartupError()
                    }
                }
            }
        } else {
            NSApp.terminate(nil)
        }
    }
}
