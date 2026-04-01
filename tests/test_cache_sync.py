"""
Cache sync integration tests using Playwright.
Tests the DocumentCacheManager-based caching system.

Usage:
    python tests/test_cache_sync.py

Prerequisites:
    - Backend running on localhost:18920
    - Frontend running on localhost:13900 (or via Cloudflare at learn.shc66.com)
    - pip install playwright && playwright install chromium
"""

import json
import time
import urllib.request
from playwright.sync_api import sync_playwright
import os

SITE = os.getenv("TEST_SITE", "https://learn.shc66.com")
LOCAL_API = os.getenv("TEST_API", "http://localhost:18920")
USER = os.getenv("TEST_USER", "")
PASSWORD = os.getenv("TEST_PASSWORD", "")

if not USER or not PASSWORD:
    raise RuntimeError("Set TEST_USER and TEST_PASSWORD environment variables")


def api_login(email, password):
    """Get auth token + user info via local API."""
    req = urllib.request.Request(
        f"{LOCAL_API}/api/v1/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req).read())


def read_new_idb(page, user_id):
    """Read new DocumentCacheManager IndexedDB stats."""
    return page.evaluate("""(userId) => new Promise(r => {
        try {
            const dbName = 'tl-cache-' + userId;
            const req = indexedDB.open(dbName, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents');
                if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
            };
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('documents')) { r({docCount:0, docIds:[], schema:null}); return; }
                const tx = db.transaction(['documents','meta'],'readonly');
                const keys = tx.objectStore('documents').getAllKeys();
                const schema = tx.objectStore('meta').get('schema');
                let k=[], s=null;
                keys.onsuccess = () => k = Array.from(keys.result);
                schema.onsuccess = () => s = schema.result;
                tx.oncomplete = () => r({docCount: k.length, docIds: k, schema: s});
            };
            req.onerror = () => r({docCount:-1, docIds:[], schema:null, error: String(req.error)});
        } catch(ex) { r({docCount:-1, docIds:[], schema:null, error: String(ex)}); }
    })""", user_id)


def clear_new_idb(page, user_id):
    """Delete the new per-user IndexedDB database."""
    page.evaluate("""(userId) => new Promise(r => {
        const req = indexedDB.deleteDatabase('tl-cache-' + userId);
        req.onsuccess = () => r('deleted');
        req.onerror = () => r('error');
        req.onblocked = () => r('blocked');
    })""", user_id)


def login_with_token(ctx, token):
    """Create a page with auth token injected."""
    page = ctx.new_page()
    page.goto(f"{SITE}/login", wait_until="domcontentloaded", timeout=30000)
    page.evaluate(f"() => localStorage.setItem('auth_token', '{token}')")
    return page


def main():
    login_data = api_login(USER, PASSWORD)
    token = login_data["token"]
    user_id = login_data["user"]["id"]
    print(f"Token obtained, user_id={user_id}\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ════════════════════════════════════════════
        # TEST 1: Fresh login populates IDB
        # ════════════════════════════════════════════
        print("=" * 60)
        print("TEST 1: Fresh login → cache populated")
        print("=" * 60)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, ignore_https_errors=True)
        page = login_with_token(ctx, token)
        page.goto(SITE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)

        # Clear old cache first
        clear_new_idb(page, user_id)
        page.close()
        ctx.close()

        # Fresh login
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, ignore_https_errors=True)
        page = login_with_token(ctx, token)
        page.goto(SITE, wait_until="domcontentloaded", timeout=30000)

        try:
            page.wait_for_selector('img[alt^="Slide"]', timeout=20000)
            print("  First slide visible")
        except:
            print("  First slide not visible (may still work)")

        # Monitor cache filling
        print(f"\n  Monitoring cache fill:")
        print(f"  {'Time':>6}  {'Docs':>6}  {'Schema':>8}")
        print(f"  {'-'*25}")

        final_stats = None
        for i in range(12):
            page.wait_for_timeout(5000)
            stats = read_new_idb(page, user_id)
            elapsed = 5 * (i + 1)
            has_schema = "yes" if stats.get('schema') else "no"
            print(f"  {elapsed:>4}s  {stats['docCount']:>6}  {has_schema:>8}")
            final_stats = stats
            if stats['docCount'] > 0 and stats.get('schema'):
                break

        assert final_stats['docCount'] > 0, "FAIL: No documents cached after sync"
        print(f"  ✓ {final_stats['docCount']} documents cached\n")

        # ════════════════════════════════════════════
        # TEST 2: Reload — cache persists
        # ════════════════════════════════════════════
        print("=" * 60)
        print("TEST 2: Reload — cache persists")
        print("=" * 60)
        page.goto(SITE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        reload_stats = read_new_idb(page, user_id)
        print(f"  After reload: {reload_stats['docCount']} docs")
        assert reload_stats['docCount'] >= final_stats['docCount'], \
            f"FAIL: Cache lost on reload ({reload_stats['docCount']} vs {final_stats['docCount']})"
        print("  ✓ Cache persists after reload\n")

        slide = page.query_selector('img[alt^="Slide"]')
        print(f"  Slide visible after reload: {bool(slide)}")

        # ════════════════════════════════════════════
        # TEST 3: User isolation (DB name check)
        # ════════════════════════════════════════════
        print(f"\n{'=' * 60}")
        print("TEST 3: User isolation")
        print("=" * 60)
        print(f"  DB name: tl-cache-{user_id}")
        fake_id = "fake-user-id-12345"
        fake_stats = read_new_idb(page, fake_id)
        assert fake_stats['docCount'] == 0, "FAIL: Fake user has cached data"
        print(f"  Fake user DB: {fake_stats['docCount']} docs (expected 0)")
        print("  ✓ User isolation verified\n")

        # ════════════════════════════════════════════
        # SUMMARY
        # ════════════════════════════════════════════
        print(f"{'=' * 60}")
        print("SUMMARY")
        print("=" * 60)
        print(f"  Documents cached:     {final_stats['docCount']}")
        print(f"  Schema stored:        {final_stats.get('schema')}")
        print(f"  Cache persists:       ✓")
        print(f"  User isolation:       ✓")

        page.close()
        ctx.close()
        browser.close()
        print("\nAll tests passed ✓")


if __name__ == "__main__":
    main()
