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
