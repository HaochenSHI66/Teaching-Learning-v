#!/usr/bin/env python3
"""
eval_format.py — JSON schema compliance checker for slide explanations.

Scans all SlideExplanations for user "shc" and reports:
1. JSON parse success rate
2. Schema compliance rate per required field
3. CLT chunking compliance (sub_items <= 4)
4. Redundancy proxy (explanation length > 200 chars)

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

REQUIRED_FIELDS = [
    "grounding",
    "items",
    "content_type",
    "self_explanation_prompt",
    "concepts",
]

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
# Schema validation
# ---------------------------------------------------------------------------

def validate_meta_json(meta_raw: Any) -> tuple[bool, dict | None]:
    """
    Try to parse meta as JSON. Returns (is_valid, parsed_dict).
    If meta is already a dict (from SQLite JSON), treat as valid.
    """
    if isinstance(meta_raw, dict):
        return (True, meta_raw if meta_raw else None)

    if not meta_raw:
        return (False, None)

    if isinstance(meta_raw, str):
        try:
            parsed = json.loads(meta_raw)
            return (isinstance(parsed, dict), parsed if isinstance(parsed, dict) else None)
        except (json.JSONDecodeError, ValueError):
            return (False, None)

    return (False, None)


def check_schema_compliance(meta: dict) -> dict:
    """
    Check compliance with expected JSON schema.
    Returns dict with compliance status for each field.
    """
    result = {
        "meta_non_empty": bool(meta),
        "grounding_present": "grounding" in meta,
        "grounding_non_empty": False,
        "items_non_empty": False,
        "content_type_valid": False,
        "self_expl_key_present": "self_explanation_prompt" in meta,
        "concepts_key_present": "concepts" in meta,
    }

    # Check grounding: must have visual_elements as non-empty list
    if result["grounding_present"]:
        grounding = meta.get("grounding", {})
        if isinstance(grounding, dict):
            visual_elements = grounding.get("visual_elements", [])
            result["grounding_non_empty"] = (
                isinstance(visual_elements, list) and len(visual_elements) > 0
            )

    # Check items: must be non-empty list
    items = meta.get("items", [])
    result["items_non_empty"] = isinstance(items, list) and len(items) > 0

    # Check content_type: must be one of the valid values
    content_type = meta.get("content_type")
    result["content_type_valid"] = content_type in VALID_CONTENT_TYPES

    return result


def check_chunking_compliance(meta: dict) -> tuple[int, int]:
    """
    Check CLT chunking compliance: sub_items <= 4 per item.
    Returns (violations_count, total_items_with_sub_items).
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


def count_verbose_items(meta: dict) -> tuple[int, int]:
    """
    Count items with explanation > 200 characters (redundancy proxy).
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
        if isinstance(explanation, str) and len(explanation) > 200:
            over_limit += 1

    return over_limit, total


# ---------------------------------------------------------------------------
# Main evaluation
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
    conn.row_factory = sqlite3.Row  # Enable column access by name
    user_id = get_user_id(conn, args.user)
    print(f"User: {args.user} (id={user_id})")

    rows = load_slides_with_explanations(conn, user_id, args.document_id, args.limit)
    print(f"Loaded {len(rows)} slide explanations.")
    conn.close()

    if not rows:
        raise SystemExit("No slide explanations found for this user/document.")

    # ---------------------------------------------------------------------------
    # Evaluate each slide
    # ---------------------------------------------------------------------------

    results: list[dict] = []

    # Counters for schema compliance
    meta_non_empty_count = 0
    grounding_present_count = 0
    grounding_non_empty_count = 0
    items_non_empty_count = 0
    content_type_valid_count = 0
    self_expl_key_present_count = 0
    concepts_key_present_count = 0

    # Counters for chunking
    total_chunking_violations = 0
    total_items_with_subs = 0

    # Counters for verbosity
    total_verbose_items = 0
    total_items_count = 0

    for i, row in enumerate(rows):
        exp_id = row["exp_id"]
        filename = row["filename"]
        page_num = row["page_num"]
        meta_raw = row["meta"]

        # Validate JSON
        is_valid, meta = validate_meta_json(meta_raw)

        if not is_valid or not meta:
            result = {
                "exp_id": exp_id,
                "filename": filename,
                "page_num": page_num,
                "meta_valid": False,
                "schema": {field: False for field in REQUIRED_FIELDS},
                "chunking_violations": 0,
                "verbose_items": 0,
            }
            results.append(result)
            continue

        # Check schema compliance
        schema_check = check_schema_compliance(meta)
        meta_non_empty_count += 1 if schema_check["meta_non_empty"] else 0
        grounding_present_count += 1 if schema_check["grounding_present"] else 0
        grounding_non_empty_count += 1 if schema_check["grounding_non_empty"] else 0
        items_non_empty_count += 1 if schema_check["items_non_empty"] else 0
        content_type_valid_count += 1 if schema_check["content_type_valid"] else 0
        self_expl_key_present_count += 1 if schema_check["self_expl_key_present"] else 0
        concepts_key_present_count += 1 if schema_check["concepts_key_present"] else 0

        # Check chunking compliance
        chunking_violations, items_with_subs = check_chunking_compliance(meta)
        total_chunking_violations += chunking_violations
        total_items_with_subs += items_with_subs

        # Check verbosity
        verbose_items, items_count = count_verbose_items(meta)
        total_verbose_items += verbose_items
        total_items_count += items_count

        result = {
            "exp_id": exp_id,
            "filename": filename,
            "page_num": page_num,
            "meta_valid": True,
            "schema": schema_check,
            "chunking_violations": chunking_violations,
            "verbose_items": verbose_items,
        }
        results.append(result)

    # ---------------------------------------------------------------------------
    # Print summary
    # ---------------------------------------------------------------------------

    total = len(rows)

    print("\n" + "=" * 60)
    print(f"Format Evaluation — user: {args.user}")
    print(f"Total explanations scanned: {total}")
    print()

    print("JSON / Schema:")
    print(f"  meta non-empty:         {meta_non_empty_count:3d}/{total:3d}   ({100*meta_non_empty_count/total:5.1f}%)")
    print(f"  grounding present:      {grounding_present_count:3d}/{total:3d}   ({100*grounding_present_count/total:5.1f}%)")
    print(f"  grounding non-empty:    {grounding_non_empty_count:3d}/{total:3d}   ({100*grounding_non_empty_count/total:5.1f}%)")
    print(f"  items non-empty:        {items_non_empty_count:3d}/{total:3d}   ({100*items_non_empty_count/total:5.1f}%)")
    print(f"  content_type valid:     {content_type_valid_count:3d}/{total:3d}   ({100*content_type_valid_count/total:5.1f}%)")
    print(f"  self_expl key present:  {self_expl_key_present_count:3d}/{total:3d}   ({100*self_expl_key_present_count/total:5.1f}%)")
    print(f"  concepts key present:   {concepts_key_present_count:3d}/{total:3d}   ({100*concepts_key_present_count/total:5.1f}%)")
    print()

    print("CLT Compliance:")
    print(f"  items with sub_items > 4:  {total_chunking_violations} violations")
    if total_items_with_subs > 0:
        chunking_pass_rate = 100 * (total_items_with_subs - total_chunking_violations) / total_items_with_subs
        print(f"  Chunking pass rate:        {chunking_pass_rate:.1f}%")
    else:
        print(f"  Chunking pass rate:        N/A (no items with sub_items)")
    print()

    print("Verbosity proxy (explanation > 200 chars):")
    if total_items_count > 0:
        print(f"  Items over limit:       {total_verbose_items:3d}/{total_items_count:3d}  ({100*total_verbose_items/total_items_count:5.1f}%)")
    else:
        print(f"  Items over limit:       N/A (no items)")
    print()

    # Save detailed results to JSON
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
                "summary": {
                    "meta_non_empty": meta_non_empty_count,
                    "grounding_present": grounding_present_count,
                    "grounding_non_empty": grounding_non_empty_count,
                    "items_non_empty": items_non_empty_count,
                    "content_type_valid": content_type_valid_count,
                    "self_expl_key_present": self_expl_key_present_count,
                    "concepts_key_present": concepts_key_present_count,
                    "chunking_violations": total_chunking_violations,
                    "verbose_items": total_verbose_items,
                    "total_items": total_items_count,
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
