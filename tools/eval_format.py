#!/usr/bin/env python3
"""
eval_format.py — JSON schema compliance checker for slide explanations.

Detects OLD format (pre-2026-05-03: structured_items / sections) and
NEW format (post-upgrade: items / grounding / self_explanation_prompt) and
reports compliance metrics for each group separately.

Usage:
    python tools/eval_format.py                  # all slides for user "shc"
    python tools/eval_format.py --limit 20       # first 20 slides
    python tools/eval_format.py --document-id X  # specific document
    python tools/eval_format.py --db /path/db    # custom DB
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = PROJECT_ROOT / "backend" / "storage" / "app.db"

VALID_CONTENT_TYPES = {"title", "toc", "intro", "content", "example", "summary"}


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_user_id(conn: sqlite3.Connection, user_hint: str = "shc") -> str:
    """Find user ID by email fragment."""
    cur = conn.execute(
        "SELECT id, email FROM user WHERE email LIKE ?",
        (f"%{user_hint}%",),
    )
    rows = cur.fetchall()
    if not rows:
        raise SystemExit(f"No user found with email containing '{user_hint}'")
    if len(rows) > 1:
        emails = ", ".join(r[1] for r in rows)
        print(f"[warn] Multiple users matched '{user_hint}': {emails}. Using first.", file=sys.stderr)
    return rows[0][0]


def load_slides_with_explanations(
    conn: sqlite3.Connection,
    user_id: str,
    document_id: str | None,
    limit: int | None,
) -> list[dict]:
    """Return list of dicts with slide explanation info."""
    sql = """
        SELECT
            se.id         AS exp_id,
            se.document_id,
            se.slide_id,
            se.page_num,
            se.markdown,
            se.meta,
            d.filename
        FROM slideexplanation se
        JOIN document d ON se.document_id = d.id
        WHERE d.user_id = ?
    """
    params: list[Any] = [user_id]

    if document_id:
        sql += " AND se.document_id = ?"
        params.append(document_id)

    sql += " ORDER BY d.filename, se.page_num"

    if limit:
        sql += " LIMIT ?"
        params.append(limit)

    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    rows = cur.fetchall()
    return [dict(zip(cols, r)) for r in rows]


# ---------------------------------------------------------------------------
# Format detection
# ---------------------------------------------------------------------------

def detect_format(meta: dict) -> str:
    if not meta:
        return "empty"
    if "items" in meta or "grounding" in meta:
        return "new"
    if "structured_items" in meta or "sections" in meta:
        return "old"
    return "unknown"


# ---------------------------------------------------------------------------
# Schema validation helpers
# ---------------------------------------------------------------------------

def validate_meta_json(meta_raw: Any, exp_id: Any) -> tuple[bool, dict | None]:
    """
    Try to parse meta as JSON. Returns (is_valid, parsed_dict).
    If meta is already a dict (from SQLite JSON), treat as valid.
    Prints a warning to stderr for invalid JSON.
    """
    if isinstance(meta_raw, dict):
        return (True, meta_raw if meta_raw else None)

    if not meta_raw:
        return (False, None)

    if isinstance(meta_raw, str):
        try:
            parsed = json.loads(meta_raw)
            return (isinstance(parsed, dict), parsed if isinstance(parsed, dict) else None)
        except (json.JSONDecodeError, ValueError) as exc:
            print(f"[warn] exp_id={exp_id}: invalid JSON in meta — {exc}", file=sys.stderr)
            return (False, None)

    return (False, None)


# ---------------------------------------------------------------------------
# Old-format checks (structured_items / sections)
# ---------------------------------------------------------------------------

def check_old_format(meta: dict) -> dict:
    """Return compliance flags for old-format slides."""
    structured_items = meta.get("structured_items", [])
    return {
        "meta_non_empty": bool(meta),
        "structured_items_non_empty": isinstance(structured_items, list) and len(structured_items) > 0,
        "content_type_valid": meta.get("content_type") in VALID_CONTENT_TYPES,
        "concepts_present": "concepts" in meta,
    }


def check_old_chunking(meta: dict) -> tuple[int, int]:
    """
    CLT chunking for old format: sub_items <= 4 per item in structured_items.
    Returns (violations, total_items_with_sub_items).
    """
    items = meta.get("structured_items", [])
    violations = 0
    items_with_subs = 0

    for item in items:
        if not isinstance(item, dict):
            continue
        sub_items = item.get("sub_items", [])
        if isinstance(sub_items, list) and len(sub_items) > 0:
            items_with_subs += 1
            if len(sub_items) > 4:
                violations += 1

    return violations, items_with_subs


def count_old_verbose_items(meta: dict) -> tuple[int, int]:
    """
    Verbosity proxy for old format items.
    Returns (items_over_limit, total_items).
    """
    items = meta.get("structured_items", [])
    over_limit = 0
    total = 0

    for item in items:
        if not isinstance(item, dict):
            continue
        total += 1
        explanation = item.get("explanation", "")
        # heuristic proxy for over-explanation; adjust as needed
        if isinstance(explanation, str) and len(explanation) > 200:
            over_limit += 1

    return over_limit, total


# ---------------------------------------------------------------------------
# New-format checks (items / grounding)
# ---------------------------------------------------------------------------

def check_new_format(meta: dict) -> dict:
    """Return compliance flags for new-format slides."""
    grounding = meta.get("grounding", {})
    grounding_non_empty = False
    if isinstance(grounding, dict):
        visual_elements = grounding.get("visual_elements", [])
        grounding_non_empty = isinstance(visual_elements, list) and len(visual_elements) > 0

    items = meta.get("items", [])
    return {
        "grounding_present": "grounding" in meta,
        "grounding_non_empty": grounding_non_empty,
        "items_non_empty": isinstance(items, list) and len(items) > 0,
        "content_type_valid": meta.get("content_type") in VALID_CONTENT_TYPES,
        "self_expl_key_present": "self_explanation_prompt" in meta,
        "concepts_present": "concepts" in meta,
    }


def check_new_chunking(meta: dict) -> tuple[int, int]:
    """
    CLT chunking for new format: sub_items <= 4 per item in items.
    Returns (violations, total_items_with_sub_items).
    """
    items = meta.get("items", [])
    violations = 0
    items_with_subs = 0

    for item in items:
        if not isinstance(item, dict):
            continue
        sub_items = item.get("sub_items", [])
        if isinstance(sub_items, list) and len(sub_items) > 0:
            items_with_subs += 1
            if len(sub_items) > 4:
                violations += 1

    return violations, items_with_subs


def count_new_verbose_items(meta: dict) -> tuple[int, int]:
    """
    Verbosity proxy for new format items.
    Returns (items_over_limit, total_items).
    """
    items = meta.get("items", [])
    over_limit = 0
    total = 0

    for item in items:
        if not isinstance(item, dict):
            continue
        total += 1
        explanation = item.get("explanation", "")
        # heuristic proxy for over-explanation; adjust as needed
        if isinstance(explanation, str) and len(explanation) > 200:
            over_limit += 1

    return over_limit, total


# ---------------------------------------------------------------------------
# Report helpers
# ---------------------------------------------------------------------------

def _pct(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return "  N/A"
    return f"{100 * numerator / denominator:5.1f}%"


def _row(label: str, n: int, d: int) -> str:
    return f"  {label:<36s} {n:3d}/{d:<3d}  ({_pct(n, d)})"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="JSON schema compliance checker for slide explanations")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to SQLite DB")
    parser.add_argument("--document-id", help="Evaluate a specific document only")
    parser.add_argument("--limit", type=int, help="Max slides to evaluate")
    parser.add_argument("--user", default="shc", help="User email fragment (default: shc)")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        raise SystemExit(f"DB not found: {db_path}")

    conn = sqlite3.connect(str(db_path))
    user_id = get_user_id(conn, args.user)

    rows = load_slides_with_explanations(conn, user_id, args.document_id, args.limit)
    conn.close()

    if not rows:
        raise SystemExit("No slide explanations found for this user/document.")

    # -----------------------------------------------------------------------
    # Evaluate each slide
    # -----------------------------------------------------------------------

    results: list[dict] = []

    # Format counters
    count_old = 0
    count_new = 0
    count_empty = 0
    count_unknown = 0

    # Old-format accumulators
    old_meta_non_empty = 0
    old_structured_items_non_empty = 0
    old_content_type_valid = 0
    old_concepts_present = 0
    old_chunking_violations = 0
    old_items_with_subs = 0
    old_verbose_items = 0
    old_total_items = 0

    # New-format accumulators
    new_grounding_present = 0
    new_grounding_non_empty = 0
    new_items_non_empty = 0
    new_content_type_valid = 0
    new_self_expl_key = 0
    new_concepts_present = 0
    new_chunking_violations = 0
    new_items_with_subs = 0

    for row in rows:
        exp_id = row["exp_id"]
        filename = row["filename"]
        page_num = row["page_num"]
        meta_raw = row["meta"]

        is_valid, meta = validate_meta_json(meta_raw, exp_id)

        if not is_valid or meta is None:
            meta = {}

        fmt = detect_format(meta)

        result: dict = {
            "exp_id": exp_id,
            "filename": filename,
            "page_num": page_num,
            "format": fmt,
        }

        if fmt == "old":
            count_old += 1
            flags = check_old_format(meta)
            old_meta_non_empty += flags["meta_non_empty"]
            old_structured_items_non_empty += flags["structured_items_non_empty"]
            old_content_type_valid += flags["content_type_valid"]
            old_concepts_present += flags["concepts_present"]
            v, s = check_old_chunking(meta)
            old_chunking_violations += v
            old_items_with_subs += s
            vi, ti = count_old_verbose_items(meta)
            old_verbose_items += vi
            old_total_items += ti
            result["schema"] = flags

        elif fmt == "new":
            count_new += 1
            flags = check_new_format(meta)
            new_grounding_present += flags["grounding_present"]
            new_grounding_non_empty += flags["grounding_non_empty"]
            new_items_non_empty += flags["items_non_empty"]
            new_content_type_valid += flags["content_type_valid"]
            new_self_expl_key += flags["self_expl_key_present"]
            new_concepts_present += flags["concepts_present"]
            v, s = check_new_chunking(meta)
            new_chunking_violations += v
            new_items_with_subs += s
            result["schema"] = flags

        elif fmt == "empty":
            count_empty += 1
        else:
            count_unknown += 1

        results.append(result)

    # -----------------------------------------------------------------------
    # Print summary
    # -----------------------------------------------------------------------

    total = len(rows)

    print()
    print("=" * 60)
    print(f"Format Evaluation — user: {args.user}")
    print(f"Total explanations scanned: {total}")
    print()
    print("Format Distribution:")
    print(f"  Old format (pre-2026-05-03):  {count_old}/{total}  ({_pct(count_old, total)})")
    print(f"  New format (post-upgrade):    {count_new}/{total}  ({_pct(count_new, total)})")
    print(f"  Empty meta:                   {count_empty}/{total}  ({_pct(count_empty, total)})")
    if count_unknown:
        print(f"  Unknown format:               {count_unknown}/{total}  ({_pct(count_unknown, total)})")
    print()

    # -- Old format section --
    if count_old > 0:
        print("── Old Format Compliance (structured_items / sections) ──")
        print(_row("meta non-empty:", old_meta_non_empty, count_old))
        print(_row("structured_items non-empty:", old_structured_items_non_empty, count_old))
        print(_row("content_type valid:", old_content_type_valid, count_old))
        print(_row("concepts present:", old_concepts_present, count_old))
        if old_items_with_subs > 0:
            chunking_pass = old_items_with_subs - old_chunking_violations
            print(f"  CLT violations (sub_items>4):     {old_chunking_violations} violations out of {old_items_with_subs} items with sub_items")
            print(f"  Chunking pass rate:              {_pct(chunking_pass, old_items_with_subs)}")
        else:
            print("  Chunking pass rate:               N/A (no items with sub_items)")
        if old_total_items > 0:
            print(f"  Verbosity proxy (>200 chars):     {old_verbose_items}/{old_total_items} items  ({_pct(old_verbose_items, old_total_items)})")
        else:
            print("  Verbosity proxy (>200 chars):     N/A (no items)")
        print()
    else:
        print("── Old Format Compliance ──  (no old-format slides in this sample)")
        print()

    # -- New format section --
    if count_new > 0:
        print("── New Format Compliance (items / grounding) ──")
        print(_row("grounding present:", new_grounding_present, count_new))
        print(_row("grounding non-empty:", new_grounding_non_empty, count_new))
        print(_row("items non-empty:", new_items_non_empty, count_new))
        print(_row("content_type valid:", new_content_type_valid, count_new))
        print(_row("self_explanation_prompt key:", new_self_expl_key, count_new))
        print(_row("concepts present:", new_concepts_present, count_new))
        if new_items_with_subs > 0:
            chunking_pass = new_items_with_subs - new_chunking_violations
            print(f"  Chunking pass rate:              {_pct(chunking_pass, new_items_with_subs)}")
        else:
            print("  Chunking pass rate:               N/A (no items with sub_items)")
        print()
    else:
        print("── New Format Compliance ──  (no new-format slides in this sample)")
        print()

    # -----------------------------------------------------------------------
    # Save results to JSON
    # -----------------------------------------------------------------------

    output_dir = PROJECT_ROOT / "tools" / "eval_results"
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = output_dir / f"format_{timestamp}.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now().isoformat(),
                "user": args.user,
                "document_id_filter": args.document_id,
                "total_slides": total,
                "format_distribution": {
                    "old": count_old,
                    "new": count_new,
                    "empty": count_empty,
                    "unknown": count_unknown,
                },
                "old_format_summary": {
                    "meta_non_empty": old_meta_non_empty,
                    "structured_items_non_empty": old_structured_items_non_empty,
                    "content_type_valid": old_content_type_valid,
                    "concepts_present": old_concepts_present,
                    "chunking_violations": old_chunking_violations,
                    "items_with_sub_items": old_items_with_subs,
                    "verbose_items": old_verbose_items,
                    "total_items": old_total_items,
                },
                "new_format_summary": {
                    "grounding_present": new_grounding_present,
                    "grounding_non_empty": new_grounding_non_empty,
                    "items_non_empty": new_items_non_empty,
                    "content_type_valid": new_content_type_valid,
                    "self_expl_key_present": new_self_expl_key,
                    "concepts_present": new_concepts_present,
                    "chunking_violations": new_chunking_violations,
                    "items_with_sub_items": new_items_with_subs,
                },
                "results": results,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"Results saved to: {output_path}")


if __name__ == "__main__":
    main()
