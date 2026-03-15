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

    /// Ensures both LaunchAgents are bootstrapped and running.
    /// Bootstraps first (no-op if already loaded), then kickstarts.
    /// Completion is called on main thread when done.
    func ensureServicesRunning(completion: @escaping () -> Void) {
        let uid = getuid()
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let agentsDir = "\(home)/Library/LaunchAgents"
        DispatchQueue.global(qos: .userInitiated).async {
            // enable first: disabled services fail bootstrap with EIO on macOS Ventura+
            self.runLaunchctl(["enable", "gui/\(uid)/\(self.backendLabel)"])
            self.runLaunchctl(["enable", "gui/\(uid)/\(self.frontendLabel)"])
            // bootstrap is idempotent: silently fails if already loaded
            self.runLaunchctl(["bootstrap", "gui/\(uid)", "\(agentsDir)/com.teachinglearning.backend.plist"])
            self.runLaunchctl(["bootstrap", "gui/\(uid)", "\(agentsDir)/com.teachinglearning.frontend.plist"])
            // kickstart ensures the process is actually running
            self.runLaunchctl(["kickstart", "gui/\(uid)/\(self.backendLabel)"])
            self.runLaunchctl(["kickstart", "gui/\(uid)/\(self.frontendLabel)"])
            DispatchQueue.main.async(execute: completion)
        }
    }

    /// Stops both services: kills the process and disables KeepAlive restart.
    /// Does NOT bootout — keeps plist loaded so bootstrap is not needed on next start.
    func stopServices() {
        let uid = getuid()
        // Disable prevents KeepAlive from restarting after kill
        runLaunchctl(["disable", "gui/\(uid)/\(backendLabel)"])
        runLaunchctl(["disable", "gui/\(uid)/\(frontendLabel)"])
        runLaunchctl(["kill", "SIGTERM", "gui/\(uid)/\(backendLabel)"])
        runLaunchctl(["kill", "SIGTERM", "gui/\(uid)/\(frontendLabel)"])
    }

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
    func waitForBackend(maxRetries: Int = 60, completion: @escaping (_ success: Bool) -> Void) {
        // Give the process a moment to bind the port before first poll
        DispatchQueue.global().asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.pollBackend(attempt: 0, maxRetries: maxRetries, completion: completion)
        }
    }

    private func pollBackend(attempt: Int, maxRetries: Int, completion: @escaping (Bool) -> Void) {
        if attempt >= maxRetries {
            DispatchQueue.main.async { completion(false) }
            return
        }
        let session = makeEphemeralSession(timeout: 2.0)
        session.dataTask(with: URL(string: "http://127.0.0.1:8000/health")!) { [weak self] _, resp, _ in
            if (resp as? HTTPURLResponse)?.statusCode == 200 {
                DispatchQueue.main.async { completion(true) }
            } else {
                // Each attempt blocks up to 2s via request timeout.
                // 60 retries × 2s = ~120s worst-case total.
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
