#!/usr/bin/env python3
"""
rubric_judge.py — 7-dimensional LLM-Rubric evaluator for slide explanations.

Usage:
    python tools/rubric_judge.py                        # all slides for user "shc"
    python tools/rubric_judge.py --document-id <id>    # specific document
    python tools/rubric_judge.py --limit 5             # quick test
    python tools/rubric_judge.py --db /path/to/app.db  # custom DB path
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import warnings
from datetime import datetime
from pathlib import Path
from statistics import mean, stdev
from typing import Any

# ---------------------------------------------------------------------------
# Path setup: allow importing ModelGateway from backend without installing it
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

# Load .env from backend/.env before importing ModelGateway
_env_path = PROJECT_ROOT / "backend" / ".env"
if _env_path.exists():
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

from app.services.model_gateway import ModelGateway  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_DB = PROJECT_ROOT / "backend" / "storage" / "app.db"
STORAGE_ROOT = PROJECT_ROOT / "backend" / "storage"

DIMENSIONS = [
    ("Q1", "Faithfulness 视觉接地"),
    ("Q2", "Redundancy 不复读"),
    ("Q3", "Coverage 概念覆盖"),
    ("Q4", "Chunking 分块"),
    ("Q5", "Signaling 重点信号"),
    ("Q6", "Self-Explanation 思考引导"),
    ("Q7", "Coherence 卡间连贯"),
]

JUDGE_SYSTEM_PROMPT = """\
你是一名严格的教育内容质量评审员。你将收到一张课程幻灯片图像和对应的讲解内容（JSON格式）。
请按照7个维度，对讲解内容进行1-4分的Likert量表评分，分数必须严格按照评分标准，不得偏高。

评分维度说明：
Q1 Faithfulness（视觉接地）：
  1分=多处内容与幻灯片不符或凭空捏造；2分=少数细节有误；3分=基本准确，个别地方未标注来源；4分=所有内容均可在幻灯片中找到依据

Q2 Redundancy（不复读）：
  1分=几乎全部照搬幻灯片原文；2分=大量直接引用；3分=部分转化为口语；4分=完全用口语化讲解，无原文照搬

Q3 Coverage（概念覆盖）：
  1分=遗漏核心概念；2分=覆盖主要内容但缺少重要细节；3分=大部分要点覆盖；4分=所有关键点和辅助细节均已涵盖

Q4 Chunking（分块）：
  1分=单一大段或完全未分块；2分=分块过少或过多；3分=分块基本合理；4分=4-8个卡片，每个卡片≤4个子项，结构清晰

Q5 Signaling（重点信号）：
  1分=无任何加粗/高亮；2分=偶尔有标记；3分=关键术语有标记但不完整；4分=关键术语和结论均有适当标注

Q6 Self-Explanation（思考引导）：
  1分=纯信息传递，无引导性问题；2分=有问题但质量低；3分=有合理的引导问题；4分=有高质量的"为什么/如何"类引导性问题

Q7 Coherence（卡间连贯）：
  1分=各卡片间毫无逻辑关联；2分=部分有关联；3分=逻辑链较清晰；4分=各卡片间有明确的逻辑递进关系

请只输出JSON，格式如下（不要添加任何其他文字）：
{
  "Q1": <1-4>, "Q1_reason": "<简短说明>",
  "Q2": <1-4>, "Q2_reason": "<简短说明>",
  "Q3": <1-4>, "Q3_reason": "<简短说明>",
  "Q4": <1-4>, "Q4_reason": "<简短说明>",
  "Q5": <1-4>, "Q5_reason": "<简短说明>",
  "Q6": <1-4>, "Q6_reason": "<简短说明>",
  "Q7": <1-4>, "Q7_reason": "<简短说明>"
}
"""


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
    """Return list of dicts with slide + explanation info."""
    sql = """
        SELECT
            se.id         AS exp_id,
            se.document_id,
            se.slide_id,
            se.page_num,
            se.markdown,
            se.meta,
            d.filename,
            s.image_path
        FROM slideexplanation se
        JOIN document d ON se.document_id = d.id
        LEFT JOIN slide s ON se.slide_id = s.id
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
# Judge LLM call
# ---------------------------------------------------------------------------

def build_judge_prompt(meta: dict | None, markdown: str) -> str:
    """Build the user-facing part of the judge prompt."""
    if meta:
        explanation_text = json.dumps(meta, ensure_ascii=False, indent=2)
        explanation_label = "讲解内容（JSON格式）"
    else:
        explanation_text = markdown or "(无内容)"
        explanation_label = "讲解内容（Markdown格式）"

    return (
        f"请评审以下幻灯片讲解内容。\n\n"
        f"{explanation_label}：\n```\n{explanation_text}\n```\n\n"
        "请根据系统提示中的7个维度进行严格评分，只输出JSON。"
    )


def call_judge(
    gateway: ModelGateway,
    image_path: Path,
    meta: dict | None,
    markdown: str,
) -> dict | None:
    """Call the judge LLM. Returns parsed dict or None on failure."""
    user_prompt = build_judge_prompt(meta, markdown)

    # Build a vision payload with the system prompt baked into the user message
    # (Qwen-VL via OpenAI-compat does not always honour a separate system role)
    full_prompt = JUDGE_SYSTEM_PROMPT + "\n\n" + user_prompt

    payload = gateway._build_payload(
        prompt_text=full_prompt,
        image_paths=[image_path],
    )
    # Request JSON output
    if not gateway._is_anthropic:
        payload["response_format"] = {"type": "json_object"}

    for attempt in range(2):
        try:
            raw = gateway._post_chat_completion(payload)
            return json.loads(raw)
        except json.JSONDecodeError:
            if attempt == 0:
                warnings.warn(f"Judge returned invalid JSON, retrying once…")
                continue
            warnings.warn(f"Judge returned invalid JSON after retry, skipping.")
            return None
        except Exception as exc:
            warnings.warn(f"Judge call failed: {exc}")
            return None
    return None


# ---------------------------------------------------------------------------
# Summary printing
# ---------------------------------------------------------------------------

def print_summary(doc_results: dict[str, list[dict]], output_path: Path) -> None:
    all_scores: dict[str, list[float]] = {q: [] for q, _ in DIMENSIONS}

    for filename, slides in doc_results.items():
        scores_per_dim: dict[str, list[float]] = {q: [] for q, _ in DIMENSIONS}
        for s in slides:
            judgment = s.get("judgment") or {}
            for q, _ in DIMENSIONS:
                if isinstance(judgment.get(q), (int, float)):
                    scores_per_dim[q].append(float(judgment[q]))
                    all_scores[q].append(float(judgment[q]))

        n = len(slides)
        evaluated = sum(1 for s in slides if s.get("judgment"))
        print(f"\nDocument: {filename} ({evaluated}/{n} slides evaluated)")
        for q, label in DIMENSIONS:
            vals = scores_per_dim[q]
            if vals:
                avg = mean(vals)
                sd = stdev(vals) if len(vals) > 1 else 0.0
                print(f"  {q} {label:<30s}: {avg:.1f} ± {sd:.1f}")
            else:
                print(f"  {q} {label:<30s}: N/A")

    # Overall summary
    print("\n" + "=" * 55)
    print("Overall (all documents)")
    overall_vals = []
    for q, label in DIMENSIONS:
        vals = all_scores[q]
        if vals:
            avg = mean(vals)
            sd = stdev(vals) if len(vals) > 1 else 0.0
            overall_vals.extend(vals)
            print(f"  {q} {label:<30s}: {avg:.1f} ± {sd:.1f}")
        else:
            print(f"  {q} {label:<30s}: N/A")

    if overall_vals:
        print(f"  {'Overall avg':<36s}: {mean(overall_vals):.2f}")

    print(f"\nResults saved to: {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="7-dimensional LLM-Rubric evaluator")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to SQLite DB")
    parser.add_argument("--document-id", help="Evaluate a specific document only")
    parser.add_argument("--limit", type=int, help="Max slides to evaluate (quick test)")
    parser.add_argument("--user", default="shc", help="User email fragment (default: shc)")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        raise SystemExit(f"DB not found: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    user_id = get_user_id(conn, args.user)
    print(f"User: {args.user} (id={user_id})")

    rows = load_slides_with_explanations(conn, user_id, args.document_id, args.limit)
    print(f"Loaded {len(rows)} slide explanations.")
    conn.close()

    if not rows:
        raise SystemExit("No slide explanations found for this user/document.")

    # Use the VISION API for judge calls (has vision capability)
    gateway = ModelGateway(
        api_key=os.environ.get("VISION_API_KEY") or os.environ.get("API_KEY"),
        base_url=os.environ.get("VISION_BASE_URL") or os.environ.get("BASE_URL"),
        model=os.environ.get("VISION_MODEL") or os.environ.get("MODEL"),
        timeout=90.0,
    )

    if not gateway.is_configured():
        raise SystemExit("Model gateway not configured. Check backend/.env for API_KEY/BASE_URL/MODEL.")

    results: list[dict] = []
    doc_results: dict[str, list[dict]] = {}

    for i, row in enumerate(rows):
        filename = row["filename"]
        page_num = row["page_num"]
        doc_id = row["document_id"]
        image_rel = row["image_path"]

        print(f"[{i+1}/{len(rows)}] {filename} page {page_num} …", end=" ", flush=True)

        # Resolve image path
        image_path = STORAGE_ROOT / doc_id / image_rel if image_rel else None
        if not image_path or not image_path.exists():
            print("SKIP (image not found)")
            result = {**dict(row), "judgment": None, "error": "image_not_found"}
            results.append(result)
            doc_results.setdefault(filename, []).append(result)
            continue

        # Parse meta
        meta = None
        if row["meta"]:
            try:
                meta = json.loads(row["meta"]) if isinstance(row["meta"], str) else row["meta"]
            except (json.JSONDecodeError, TypeError):
                pass

        judgment = call_judge(gateway, image_path, meta, row["markdown"] or "")

        if judgment:
            scores = {q: judgment.get(q) for q, _ in DIMENSIONS}
            valid = [v for v in scores.values() if isinstance(v, (int, float))]
            avg = round(mean(valid), 2) if valid else None
            print(f"OK  avg={avg}")
        else:
            print("FAILED")

        result = {
            "exp_id": row["exp_id"],
            "document_id": doc_id,
            "filename": filename,
            "page_num": page_num,
            "judgment": judgment,
            "error": None if judgment else "judge_failed",
        }
        results.append(result)
        doc_results.setdefault(filename, []).append(result)

    # Save output
    output_dir = PROJECT_ROOT / "tools" / "eval_results"
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = output_dir / f"rubric_{timestamp}.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now().isoformat(),
                "user": args.user,
                "document_id_filter": args.document_id,
                "total_slides": len(results),
                "results": results,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print_summary(doc_results, output_path)


if __name__ == "__main__":
    main()
