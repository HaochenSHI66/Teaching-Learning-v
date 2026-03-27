import Cocoa
import WebKit

/// Full-window WKWebView without URL bar.
/// Hides on close (does not terminate services).
class WebViewWindow: NSWindow {
    private var webView: WKWebView!
    private var loadingView: NSView!
    private var statusLabel: NSTextField!
    private var spinner: NSProgressIndicator!
    private var loadRetryCount = 0
    private let maxLoadRetries = 30

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
        webView.uiDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.isHidden = true

        setupLoadingView()

        let container = NSView(frame: .zero)
        container.autoresizesSubviews = true
        webView.frame = container.bounds
        loadingView.frame = container.bounds
        container.addSubview(webView)
        container.addSubview(loadingView)
        contentView = container

        // Auto-resize both subviews with the window
        webView.translatesAutoresizingMaskIntoConstraints = false
        loadingView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            loadingView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            loadingView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            loadingView.topAnchor.constraint(equalTo: container.topAnchor),
            loadingView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
    }

    private func setupLoadingView() {
        loadingView = NSView()
        loadingView.wantsLayer = true
        loadingView.layer?.backgroundColor = NSColor(red: 0.10, green: 0.12, blue: 0.18, alpha: 1.0).cgColor

        // App icon
        let iconView = NSImageView()
        let iconPath = Bundle.main.resourcePath.map { $0 + "/AppIcon.icns" } ?? ""
        if let img = NSImage(contentsOfFile: iconPath) {
            iconView.image = img
        }
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.translatesAutoresizingMaskIntoConstraints = false

        // App name label
        let nameLabel = NSTextField(labelWithString: "学习助手")
        nameLabel.font = NSFont.systemFont(ofSize: 22, weight: .semibold)
        nameLabel.textColor = NSColor.white
        nameLabel.alignment = .center
        nameLabel.translatesAutoresizingMaskIntoConstraints = false

        // Spinner
        spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.isIndeterminate = true
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimation(nil)

        // Status label
        statusLabel = NSTextField(labelWithString: "正在启动服务...")
        statusLabel.font = NSFont.systemFont(ofSize: 13)
        statusLabel.textColor = NSColor(white: 1.0, alpha: 0.55)
        statusLabel.alignment = .center
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        // Stack: icon → name → spinner → status
        let stack = NSStackView(views: [iconView, nameLabel, spinner, statusLabel])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false

        loadingView.addSubview(stack)
        NSLayoutConstraint.activate([
            iconView.widthAnchor.constraint(equalToConstant: 96),
            iconView.heightAnchor.constraint(equalToConstant: 96),
            stack.centerXAnchor.constraint(equalTo: loadingView.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: loadingView.centerYAnchor, constant: -20),
        ])
    }

    /// Show loading screen with a status message (call before makeKeyAndOrderFront).
    func showLoading(message: String = "正在启动服务...") {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.statusLabel.stringValue = message
            self.loadingView.isHidden = false
            self.webView.isHidden = true
            self.spinner.startAnimation(nil)
        }
    }

    /// Update loading status text without hiding the loading view.
    func updateLoadingStatus(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            self?.statusLabel.stringValue = message
        }
    }

    /// Loads the frontend. Call only after backend health check passes.
    func loadApp() {
        loadRetryCount = 0
        attemptLoad()
    }

    private func attemptLoad() {
        let request = URLRequest(
            url: URL(string: "http://127.0.0.1:3000")!,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        webView.load(request)
        // Webview will appear once didFinishNavigation fires
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

    func webView(_ webView: WKWebView, didFinish _: WKNavigation!) {
        spinner.stopAnimation(nil)
        loadingView.removeFromSuperview()
        webView.isHidden = false
    }

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
        // Accept both 127.0.0.1 and localhost
        let isLocal = (host == "127.0.0.1" || host == "localhost")
        if isLocal && (port == 3000 || port == 8000 || port == nil) {
            decisionHandler(.allow)
            return
        }

        // Allow about: and blob: schemes (initial empty page, file downloads)
        if url.scheme == "about" || url.scheme == "blob" {
            decisionHandler(.allow)
            return
        }

        // Redirect all external navigation to system browser
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation _: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled { return }
        guard loadRetryCount < maxLoadRetries else {
            print("[WebView] frontend load failed after \(maxLoadRetries) retries, giving up")
            return
        }
        loadRetryCount += 1
        print("[WebView] provisional load failed (\(loadRetryCount)/\(maxLoadRetries)): \(error.localizedDescription)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.attemptLoad()
        }
    }
}

// MARK: - WKUIDelegate (file upload + JS dialogs)

extension WebViewWindow: WKUIDelegate {

    // Handle target="_blank" links — load in same webview instead of opening Safari
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // Load the URL in the existing webview instead of opening a new window
        if let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    // File picker
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.pdf, .png, .jpeg, .webP]
        panel.begin { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // window.alert()
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
        completionHandler()
    }

    // window.confirm()
    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    // window.prompt()
    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = prompt
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        if alert.runModal() == .alertFirstButtonReturn {
            completionHandler(input.stringValue)
        } else {
            completionHandler(nil)
        }
    }
}
