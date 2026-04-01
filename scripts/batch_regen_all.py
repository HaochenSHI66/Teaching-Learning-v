#!/usr/bin/env python3
"""Batch regenerate explanations for ALL documents — page by page.

Multiple documents run in parallel, each page is a separate API call.

Usage:
    python3 -u scripts/batch_regen_all.py [--concurrency 3]
"""

import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API = os.getenv("API_URL", "http://localhost:18920")
USER = os.getenv("USER_EMAIL", "shc")
PASSWORD = os.getenv("USER_PASSWORD", "hwxsyyds88")
CONCURRENCY = int(sys.argv[sys.argv.index("--concurrency") + 1]) if "--concurrency" in sys.argv else 3
PAGE_TIMEOUT = 180  # 3 min per page


def api_call(method, path, token, data=None, timeout=30):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(data).encode() if data else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def login():
    resp = api_call("POST", "/api/v1/auth/login", "", {"email": USER, "password": PASSWORD})
    return resp["token"]


def get_all_docs(token):
    folders = api_call("GET", "/api/v1/folders", token)
    docs = []
    for f in folders.get("folders", []):
        for d in f.get("documents", []):
            if d["status"] == "ready" and not d["filename"].startswith("test") and not d["filename"].startswith("playwright"):
                docs.append({"id": d["id"], "name": d["filename"], "pages": d["page_count"], "folder": f["name"]})
    for d in folders.get("uncategorized", {}).get("documents", []):
        if d["status"] == "ready" and not d["filename"].startswith("test") and not d["filename"].startswith("playwright"):
            docs.append({"id": d["id"], "name": d["filename"], "pages": d["page_count"], "folder": "未归类"})
    return docs


def get_slides(token, doc_id):
    resp = api_call("GET", f"/api/v1/documents/{doc_id}/slides", token)
    return resp.get("slides", [])


def regen_one_page(token, doc_id, slide_id):
    """Regenerate explanation for a single page."""
    try:
        api_call("POST", f"/api/v1/documents/{doc_id}/slides/{slide_id}/explanations/generate", token, timeout=PAGE_TIMEOUT)
        return True
    except Exception as e:
        return str(e)[:80]


def regen_document(token, doc, doc_idx, total_docs):
    """Regenerate all pages of one document, one at a time."""
    doc_id = doc["id"]
    name = doc["name"]

    try:
        slides = get_slides(token, doc_id)
    except Exception as e:
        print(f"  [{doc_idx}/{total_docs}] ✗ {name:<40} failed to get slides: {e}", flush=True)
        return 0, doc["pages"]

    ok = 0
    fail = 0
    for i, slide in enumerate(slides):
        result = regen_one_page(token, doc_id, slide["id"])
        if result is True:
            ok += 1
        else:
            fail += 1
        # Progress every 5 pages
        if (i + 1) % 5 == 0 or i == len(slides) - 1:
            print(f"  [{doc_idx}/{total_docs}] {name:<40} {ok}/{len(slides)} pages done ({fail} failed)", flush=True)

    return ok, fail


def main():
    print("Logging in...", flush=True)
    token = login()

    print("Fetching documents...", flush=True)
    docs = get_all_docs(token)
    total_pages = sum(d["pages"] for d in docs)
    print(f"Found {len(docs)} documents, {total_pages} total pages", flush=True)
    print(f"Concurrency: {CONCURRENCY} documents in parallel", flush=True)
    print(f"Timeout per page: {PAGE_TIMEOUT}s", flush=True)
    print(flush=True)

    t_start = time.time()
    total_ok = 0
    total_fail = 0
    completed_docs = 0

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {}
        for i, doc in enumerate(docs):
            f = pool.submit(regen_document, token, doc, i + 1, len(docs))
            futures[f] = doc

        for future in as_completed(futures):
            doc = futures[future]
            ok, fail = future.result()
            total_ok += ok
            total_fail += fail
            completed_docs += 1
            elapsed = time.time() - t_start
            rate = total_ok / elapsed * 3600 if elapsed > 0 else 0
            remaining = (total_pages - total_ok - total_fail) / (rate / 3600) if rate > 0 else 0
            print(f"  >>> {doc['name']} DONE ({ok} ok, {fail} fail) | Total: {total_ok}/{total_pages} | {elapsed/60:.0f}m elapsed | ~{remaining/60:.0f}m remaining", flush=True)

    elapsed = time.time() - t_start
    print(f"\n{'='*60}", flush=True)
    print(f"COMPLETE: {total_ok}/{total_pages} pages generated, {total_fail} failed", flush=True)
    print(f"Time: {elapsed/3600:.1f} hours", flush=True)


if __name__ == "__main__":
    main()
