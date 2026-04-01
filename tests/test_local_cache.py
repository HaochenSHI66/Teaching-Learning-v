"""
Complete test: clear IndexedDB → login → wait for preload → verify cache → reload → verify cache survives

Usage:
    python tests/test_local_cache.py

Prerequisites:
    - Backend running on localhost:18920
    - Frontend running on localhost:13900 (or via Cloudflare at learn.shc66.com)
    - pip install playwright && playwright install chromium
"""

import json
import time
import urllib.request
from playwright.sync_api import sync_playwright

# ── Config ──
import os
SITE = os.getenv("TEST_SITE", "https://learn.shc66.com")
LOCAL_API = os.getenv("TEST_API", "http://localhost:18920")
USER = os.getenv("TEST_USER", "")
PASSWORD = os.getenv("TEST_PASSWORD", "")

if not USER or not PASSWORD:
    raise RuntimeError("Set TEST_USER and TEST_PASSWORD environment variables")


def get_token():
    """Get auth token via local API (fast, no Cloudflare)."""
    req = urllib.request.Request(
        f"{LOCAL_API}/api/v1/auth/login",
        data=json.dumps({"email": USER, "password": PASSWORD}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req).read())["token"]


def read_idb(page):
    """Read IndexedDB cache stats."""
    return page.evaluate("""() => new Promise(r => {
        try {
            const req = indexedDB.open('teaching-learning-cache', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                ['slides','explanations','meta'].forEach(s => {
                    if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
                });
            };
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('slides')) { r({slides:0,explanations:0,lastSync:0}); return; }
                const tx = db.transaction(['slides','explanations','meta'],'readonly');
                const sc = tx.objectStore('slides').count();
                const ec = tx.objectStore('explanations').count();
                const mc = tx.objectStore('meta').get('lastSync');
                let s=0,e=0,m=0;
                sc.onsuccess = () => s = sc.result;
                ec.onsuccess = () => e = ec.result;
                mc.onsuccess = () => m = mc.result || 0;
                tx.oncomplete = () => r({slides:s, explanations:e, lastSync:m});
            };
            req.onerror = () => r({slides:-1, explanations:-1, lastSync:0, error: String(req.error)});
        } catch(ex) { r({slides:-1, explanations:-1, lastSync:0, error: String(ex)}); }
    })""")


def clear_idb(page):
    """Delete the entire IndexedDB database."""
    page.evaluate("""() => new Promise(r => {
        const req = indexedDB.deleteDatabase('teaching-learning-cache');
        req.onsuccess = () => r('deleted');
        req.onerror = () => r('error');
        req.onblocked = () => r('blocked');
    })""")


def login_with_token(ctx, token):
    """Create a page with auth token injected (bypasses Cloudflare login form)."""
    ctx.add_cookies([{"name": "auth_token", "value": token, "domain": "learn.shc66.com", "path": "/"}])
    page = ctx.new_page()
    page.goto(f"{SITE}/login", wait_until="domcontentloaded", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('auth_token', '{token}')")
    return page


def main():
    token = get_token()
    print(f"Token obtained\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, ignore_https_errors=True)

        # ════════════════════════════════════════════
        # STEP 1: Clear cache
        # ════════════════════════════════════════════
        print("=" * 60)
        print("STEP 1: Clear IndexedDB cache")
        print("=" * 60)
        page = login_with_token(ctx, token)
        page.goto(SITE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)

        before = read_idb(page)
        print(f"  Before clear: slides={before['slides']} exp={before['explanations']}")

        clear_idb(page)
        page.wait_for_timeout(1000)

        after = read_idb(page)
        print(f"  After clear:  slides={after['slides']} exp={after['explanations']}")
        assert after['slides'] == 0, f"Clear failed: slides={after['slides']}"
        print("  ✓ Cache cleared\n")
        page.close()

        # ════════════════════════════════════════════
        # STEP 2: Fresh load — preload should populate cache
        # ════════════════════════════════════════════
        print("=" * 60)
        print("STEP 2: Fresh load → wait for preload")
        print("=" * 60)
        ctx2 = browser.new_context(viewport={"width": 1280, "height": 800}, ignore_https_errors=True)
        page = login_with_token(ctx2, token)

        t0 = time.time()
        page.goto(SITE, wait_until="domcontentloaded", timeout=30000)

        # Wait for first slide
        try:
            page.wait_for_selector('img[alt^="Slide"]', timeout=20000)
            print(f"  First slide visible: {time.time()-t0:.1f}s")
        except:
            print(f"  First slide not visible after {time.time()-t0:.1f}s")

        # Monitor cache filling every 5s for 60s
        print(f"\n  Monitoring cache fill:")
        print(f"  {'Time':>6}  {'Slides':>7}  {'Explain':>8}  {'Synced':>8}")
        print(f"  {'-'*35}")

        max_wait = 60
        final_stats = None
        for i in range(max_wait // 5):
            page.wait_for_timeout(5000)
            stats = read_idb(page)
            elapsed = 5 * (i + 1)
            synced = "yes" if stats['lastSync'] > 0 else "no"
            print(f"  {elapsed:>4}s  {stats['slides']:>7}  {stats['explanations']:>8}  {synced:>8}")
            final_stats = stats

            # Stop early if sync is complete
            if stats['lastSync'] > 0 and stats['slides'] > 40:
                break

        print(f"\n  Final: {final_stats['slides']} slides, {final_stats['explanations']} explanations cached")
        assert final_stats['slides'] > 0, "FAIL: No slides cached after preload"
        print("  ✓ Preload working\n")

        # ════════════════════════════════════════════
        # STEP 3: Reload — cache should survive and be used
        # ════════════════════════════════════════════
        print("=" * 60)
        print("STEP 3: Reload — verify cache persists")
        print("=" * 60)

        t0 = time.time()
        page.goto(SITE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        reload_stats = read_idb(page)
        print(f"  After reload: slides={reload_stats['slides']} exp={reload_stats['explanations']}")
        assert reload_stats['slides'] == final_stats['slides'], \
            f"FAIL: Cache lost on reload ({reload_stats['slides']} vs {final_stats['slides']})"
        print("  ✓ Cache persists after reload\n")

        # Check if slide appeared faster (from cache)
        slide = page.query_selector('img[alt^="Slide"]')
        t_reload = time.time() - t0
        print(f"  Reload → ready: {t_reload:.1f}s (slide visible: {bool(slide)})")

        # ════════════════════════════════════════════
        # STEP 4: Check cache freshness time
        # ════════════════════════════════════════════
        print(f"\n{'=' * 60}")
        print("STEP 4: Cache freshness")
        print("=" * 60)

        last_sync = reload_stats['lastSync']
        if last_sync > 0:
            age_s = (time.time() * 1000 - last_sync) / 1000
            print(f"  Last sync: {age_s:.0f}s ago")
            print(f"  Cache max age: 2 hours (7200s)")
            print(f"  Fresh: {'yes' if age_s < 7200 else 'no'}")
        else:
            print(f"  Last sync: never")

        # ════════════════════════════════════════════
        # SUMMARY
        # ════════════════════════════════════════════
        print(f"\n{'=' * 60}")
        print("SUMMARY")
        print("=" * 60)
        print(f"  Slides cached:        {final_stats['slides']}")
        print(f"  Explanations cached:  {final_stats['explanations']}")
        print(f"  Cache persists:       ✓")
        print(f"  Cache TTL:            2 hours")
        print(f"  Preload time:         ~{5 * (i + 1)}s")

        page.close()
        ctx2.close()
        browser.close()
        print("\nAll tests passed ✓")


if __name__ == "__main__":
    main()
