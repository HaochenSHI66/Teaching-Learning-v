#!/usr/bin/env python3
"""
eval_quiz.py — PresentAgent quiz accuracy evaluator.

Protocol (§3.2 of docs/PROMPT_OPTIMIZATION_DESIGN.md):
  For each slide + explanation pair:
    1. Generate 5 four-choice questions (slide image + explanation → VLM)
    2. Answer those questions (slide image + explanation + questions → VLM)
    3. Score: correct / 5 = quiz accuracy for that slide

Usage:
    python tools/eval_quiz.py                     # all slides for user "shc"
    python tools/eval_quiz.py --limit 10          # first 10 slides (quick test)
    python tools/eval_quiz.py --document-id <id>  # specific document
    python tools/eval_quiz.py --db <path>         # custom DB path
    python tools/eval_quiz.py --output-questions  # save generated questions to JSON
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from statistics import mean, stdev
from typing import Any

# ---------------------------------------------------------------------------
# Path setup
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

QUESTION_GEN_PROMPT = """\
You are an expert educator. You will receive a slide image and its explanation text.
Generate exactly 5 four-choice multiple-choice questions that test understanding of the slide content.

The 5 questions must cover:
1. Topic identification — what is this slide about?
2. Structural understanding — how is the content organized?
3. Main argument/conclusion — what is the key takeaway?
4. Specific detail recall — a concrete fact or term from the slide
5. Application or implication — what does this mean or how would it be used?

Rules:
- Each question has options A, B, C, D — exactly one correct answer, three plausible distractors.
- Distractors must be wrong but believable (not obviously silly).
- Base questions ONLY on what is visible in the slide and stated in the explanation.
- Write questions in the same language as the explanation (Chinese if explanation is Chinese).

Output ONLY valid JSON in this exact format (no markdown fences, no extra text):
{
  "questions": [
    {"q": "...", "A": "...", "B": "...", "C": "...", "D": "...", "answer": "A"},
    {"q": "...", "A": "...", "B": "...", "C": "...", "D": "...", "answer": "B"},
    {"q": "...", "A": "...", "B": "...", "C": "...", "D": "...", "answer": "C"},
    {"q": "...", "A": "...", "B": "...", "C": "...", "D": "...", "answer": "D"},
    {"q": "...", "A": "...", "B": "...", "C": "...", "D": "...", "answer": "A"}
  ]
}
"""

ANSWER_PROMPT_TEMPLATE = """\
You are a student who has studied the following slide and its explanation.
Answer the 5 multiple-choice questions below based on the slide image and explanation provided.

Explanation:
{explanation}

Questions:
{questions_text}

Output ONLY valid JSON in this exact format (no markdown fences, no extra text):
{{"answers": ["A", "B", "C", "D", "A"]}}

Each element in "answers" is your chosen option (A/B/C/D) for questions 1–5 in order.
"""


# ---------------------------------------------------------------------------
# DB helpers (same pattern as rubric_judge.py)
# ---------------------------------------------------------------------------

def get_user_id(conn: sqlite3.Connection, user_hint: str = "shc") -> str:
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
# Explanation text helper
# ---------------------------------------------------------------------------

def get_explanation_text(row: dict) -> str:
    """Return the best explanation text for a slide row."""
    meta = None
    if row["meta"]:
        try:
            meta = json.loads(row["meta"]) if isinstance(row["meta"], str) else row["meta"]
        except (json.JSONDecodeError, TypeError):
            pass

    if meta and isinstance(meta, dict) and meta.get("items"):
        # New format: render items as markdown
        lines = []
        for item in meta["items"]:
            title = item.get("title", "")
            if title:
                lines.append(f"**{title}**")
            for sub in item.get("sub_items", []):
                lines.append(f"- {sub}")
            explanation = item.get("explanation", "")
            if explanation:
                lines.append(explanation)
        return "\n".join(lines)

    # Old format or fallback: use markdown field
    return row["markdown"] or "(no explanation)"


# ---------------------------------------------------------------------------
# VLM calls
# ---------------------------------------------------------------------------

def generate_questions(
    gateway: ModelGateway,
    image_path: Path,
    explanation: str,
) -> dict | None:
    """Step 1: generate 5 quiz questions. Returns parsed dict or None on failure."""
    full_prompt = QUESTION_GEN_PROMPT + f"\n\nExplanation:\n{explanation}"

    for attempt in range(2):
        try:
            result = gateway.generate_vision_json(
                prompt=full_prompt,
                slide_image_path=image_path,
            )
            questions = result.get("questions", [])
            if len(questions) != 5:
                print(
                    f"  [WARN] Expected 5 questions, got {len(questions)}", file=sys.stderr
                )
            # Validate each question has required fields
            for q in questions:
                for field in ("q", "A", "B", "C", "D", "answer"):
                    if field not in q:
                        print(
                            f"  [WARN] Question missing field '{field}': {q}",
                            file=sys.stderr,
                        )
            return result
        except json.JSONDecodeError:
            if attempt == 0:
                print("  [WARN] Question gen returned invalid JSON, retrying…", file=sys.stderr)
                continue
            print("  [WARN] Question gen returned invalid JSON after retry, skipping.", file=sys.stderr)
            return None
        except Exception as exc:
            print(f"  [WARN] Question gen failed: {exc}", file=sys.stderr)
            return None
    return None


def answer_questions(
    gateway: ModelGateway,
    image_path: Path,
    explanation: str,
    questions: list[dict],
) -> list[str] | None:
    """Step 2: answer 5 questions. Returns list of 5 answer letters or None."""
    # Format questions as readable text
    lines = []
    for i, q in enumerate(questions, 1):
        lines.append(f"Q{i}: {q.get('q', '')}")
        lines.append(f"  A) {q.get('A', '')}")
        lines.append(f"  B) {q.get('B', '')}")
        lines.append(f"  C) {q.get('C', '')}")
        lines.append(f"  D) {q.get('D', '')}")
    questions_text = "\n".join(lines)

    prompt = ANSWER_PROMPT_TEMPLATE.format(
        explanation=explanation,
        questions_text=questions_text,
    )

    for attempt in range(2):
        try:
            result = gateway.generate_vision_json(
                prompt=prompt,
                slide_image_path=image_path,
            )
            answers = result.get("answers", [])
            if len(answers) != 5:
                print(
                    f"  [WARN] Expected 5 answers, got {len(answers)}", file=sys.stderr
                )
                # Pad or truncate to 5
                answers = (answers + ["?"] * 5)[:5]
            # Normalize to uppercase
            answers = [str(a).strip().upper()[:1] if a else "?" for a in answers]
            return answers
        except json.JSONDecodeError:
            if attempt == 0:
                print("  [WARN] Answer call returned invalid JSON, retrying…", file=sys.stderr)
                continue
            print("  [WARN] Answer call returned invalid JSON after retry, skipping.", file=sys.stderr)
            return None
        except Exception as exc:
            print(f"  [WARN] Answer call failed: {exc}", file=sys.stderr)
            return None
    return None


def score_answers(questions: list[dict], answers: list[str]) -> tuple[int, int]:
    """Return (correct_count, total) by comparing answers to ground truth."""
    total = min(len(questions), len(answers))
    correct = 0
    for q, a in zip(questions, answers):
        gt = str(q.get("answer", "")).strip().upper()[:1]
        if gt and a == gt:
            correct += 1
    return correct, total


# ---------------------------------------------------------------------------
# Summary printing
# ---------------------------------------------------------------------------

def print_summary(
    doc_results: dict[str, list[dict]],
    output_path: Path,
    user: str,
) -> None:
    total_slides = sum(len(v) for v in doc_results.values())
    evaluated = sum(
        1 for slides in doc_results.values() for s in slides if s.get("accuracy") is not None
    )

    print(f"\nQuiz Accuracy Evaluation — user: {user}")
    print(f"Slides evaluated: {evaluated}/{total_slides}")
    print("\nPer-document results:")

    all_accuracies: list[float] = []

    for filename, slides in doc_results.items():
        doc_correct = sum(s.get("correct", 0) for s in slides)
        doc_total_qs = sum(s.get("total_questions", 0) for s in slides)
        doc_accs = [s["accuracy"] for s in slides if s.get("accuracy") is not None]
        if doc_accs:
            doc_avg = mean(doc_accs)
            n_slides = len(doc_accs)
            print(
                f"  {filename:<40s}  {doc_avg:.2f}"
                f"  ({doc_correct}/{doc_total_qs} correct across {n_slides} slides)"
            )
            all_accuracies.extend(doc_accs)
        else:
            print(f"  {filename:<40s}  N/A")

    print()
    if all_accuracies:
        overall_mean = mean(all_accuracies)
        overall_sd = stdev(all_accuracies) if len(all_accuracies) > 1 else 0.0
        print(f"Overall quiz accuracy: {overall_mean:.2f} ± {overall_sd:.2f}")
    else:
        print("Overall quiz accuracy: N/A")

    print("Baseline (PresentAgent paper): 0.64")
    print(f"\nResults saved to: {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="PresentAgent quiz accuracy evaluator")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to SQLite DB")
    parser.add_argument("--document-id", help="Evaluate a specific document only")
    parser.add_argument("--limit", type=int, help="Max slides to evaluate (quick test)")
    parser.add_argument("--user", default="shc", help="User email fragment (default: shc)")
    parser.add_argument(
        "--output-questions",
        action="store_true",
        help="Also save generated questions to the output JSON",
    )
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        raise SystemExit(f"DB not found: {db_path}")

    conn = sqlite3.connect(str(db_path))
    user_id = get_user_id(conn, args.user)
    print(f"User: {args.user} (id={user_id})")

    rows = load_slides_with_explanations(conn, user_id, args.document_id, args.limit)
    print(f"Loaded {len(rows)} slide explanations.")
    conn.close()

    if not rows:
        raise SystemExit("No slide explanations found for this user/document.")

    gateway = ModelGateway(
        api_key=os.environ.get("VISION_API_KEY") or os.environ.get("API_KEY"),
        base_url=os.environ.get("VISION_BASE_URL") or os.environ.get("BASE_URL"),
        model=os.environ.get("VISION_MODEL") or os.environ.get("MODEL"),
        timeout=120.0,
    )

    if not gateway.is_configured():
        raise SystemExit(
            "Model gateway not configured. Check backend/.env for API_KEY/BASE_URL/MODEL."
        )

    results: list[dict] = []
    doc_results: dict[str, list[dict]] = {}

    for i, row in enumerate(rows):
        filename = row["filename"]
        page_num = row["page_num"]
        doc_id = row["document_id"]
        image_rel = row["image_path"]

        print(f"[{i+1}/{len(rows)}] {filename} page {page_num} …", end=" ", flush=True)

        # Resolve image path
        if not image_rel:
            image_path = None
        else:
            p = Path(image_rel)
            image_path = p if p.is_absolute() else STORAGE_ROOT / doc_id / p

        if not image_path or not image_path.exists():
            print("SKIP (image not found)")
            result: dict = {
                "exp_id": row["exp_id"],
                "document_id": doc_id,
                "filename": filename,
                "page_num": page_num,
                "accuracy": None,
                "correct": 0,
                "total_questions": 0,
                "error": "image_not_found",
            }
            results.append(result)
            doc_results.setdefault(filename, []).append(result)
            continue

        explanation = get_explanation_text(row)

        # Step 1: generate questions
        print("gen-q", end=" ", flush=True)
        q_result = generate_questions(gateway, image_path, explanation)

        if not q_result or not q_result.get("questions"):
            print("FAILED (question gen)")
            result = {
                "exp_id": row["exp_id"],
                "document_id": doc_id,
                "filename": filename,
                "page_num": page_num,
                "accuracy": None,
                "correct": 0,
                "total_questions": 0,
                "error": "question_gen_failed",
            }
            results.append(result)
            doc_results.setdefault(filename, []).append(result)
            continue

        questions = q_result["questions"]

        # Step 2: answer questions
        print("ans", end=" ", flush=True)
        answers = answer_questions(gateway, image_path, explanation, questions)

        if answers is None:
            print("FAILED (answering)")
            result = {
                "exp_id": row["exp_id"],
                "document_id": doc_id,
                "filename": filename,
                "page_num": page_num,
                "accuracy": None,
                "correct": 0,
                "total_questions": len(questions),
                "error": "answer_failed",
            }
            if args.output_questions:
                result["questions"] = questions
            results.append(result)
            doc_results.setdefault(filename, []).append(result)
            continue

        # Step 3: score
        correct, total = score_answers(questions, answers)
        accuracy = correct / total if total > 0 else 0.0
        print(f"OK  {correct}/{total} = {accuracy:.2f}")

        result = {
            "exp_id": row["exp_id"],
            "document_id": doc_id,
            "filename": filename,
            "page_num": page_num,
            "accuracy": accuracy,
            "correct": correct,
            "total_questions": total,
            "answers_given": answers,
            "correct_answers": [q.get("answer") for q in questions],
            "error": None,
        }
        if args.output_questions:
            result["questions"] = questions

        results.append(result)
        doc_results.setdefault(filename, []).append(result)

    # Save output
    output_dir = PROJECT_ROOT / "tools" / "eval_results"
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = output_dir / f"quiz_{timestamp}.json"

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

    print_summary(doc_results, output_path, args.user)


if __name__ == "__main__":
    main()
