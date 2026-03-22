#!/usr/bin/env python3
"""
Generate explanations for sample slides using the dual pipeline,
then output results for quality evaluation.

Usage:
    cd backend && python3 ../scripts/eval_quality.py

Output: writes results to ../scripts/eval_results.json
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

# Add backend to path
_backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(_backend_dir))
os.chdir(_backend_dir)

from dotenv import load_dotenv
load_dotenv(_backend_dir / ".env", override=True)

from app.services.dual_pipeline import DualModelPipeline, _fetch_previous_context
from app.services.prompt_templates import build_vision_extraction_prompt, build_text_explanation_prompt


# Test pages: diverse content types and courses
TEST_PAGES = [
    # (document_filename_pattern, page_num, reason)
    ("AMA1500_Lecture5", 31, "math example page"),
    ("AMA1500_Lecture9", 14, "math concept page"),
    ("Ch2-ApplicationLayer", 65, "CS networking concept"),
    ("Lecture_2.pdf", 23, "CS data structures"),
    ("Lec03_Linux", 30, "OS/Linux concept"),
    ("L3-Lecture-Image.processing2", 8, "image processing with formulas"),
    ("Supervised Learning-NN", 15, "neural network concept"),
    ("AMA1500_Lecture11", 20, "math example with solution"),
]


def find_slide(conn: sqlite3.Connection, filename_pattern: str, page_num: int):
    """Find a slide by filename pattern and page number."""
    row = conn.execute(
        """
        SELECT s.id, s.document_id, s.image_path, d.filename,
               se.markdown as existing_explanation,
               sx.payload as extract_payload
        FROM slide s
        JOIN document d ON d.id = s.document_id
        LEFT JOIN slideexplanation se ON se.slide_id = s.id
        LEFT JOIN slideextract sx ON sx.slide_id = s.id
        WHERE d.filename LIKE ? AND s.page_num = ?
        """,
        (f"%{filename_pattern}%", page_num),
    ).fetchone()
    return row


def main():
    conn = sqlite3.connect("storage/app.db")
    pipeline = DualModelPipeline()

    if not pipeline.is_configured():
        print("ERROR: Dual pipeline not configured. Check .env")
        sys.exit(1)

    results = []
    for filename_pattern, page_num, reason in TEST_PAGES:
        print(f"\n{'='*60}")
        print(f"Processing: {filename_pattern} page {page_num} ({reason})")
        print(f"{'='*60}")

        row = find_slide(conn, filename_pattern, page_num)
        if not row:
            print(f"  SKIP: not found in database")
            results.append({
                "file": filename_pattern,
                "page": page_num,
                "reason": reason,
                "status": "not_found",
            })
            continue

        slide_id, doc_id, image_path, filename, existing_md, extract_payload_json = row
        image_full_path = Path("storage") / doc_id / "slides" / f"slide_{page_num:03d}.png"

        if not image_full_path.exists():
            print(f"  SKIP: image not found at {image_full_path}")
            results.append({
                "file": filename,
                "page": page_num,
                "reason": reason,
                "status": "image_not_found",
            })
            continue

        extract_payload = json.loads(extract_payload_json) if extract_payload_json else {}

        # Build extraction text (same as explanation_engine does)
        from app.services.explanation_engine import _extraction_text_for_prompt
        extraction_text = _extraction_text_for_prompt(
            extract_payload.get("raw_text", ""),
            extract_payload,
        )

        try:
            # Stage 1: Vision extraction
            vision_prompt = build_vision_extraction_prompt(extraction_text=extraction_text)
            vision_result = pipeline.vision_gateway.generate_vision_extraction(
                prompt=vision_prompt,
                slide_image_path=image_full_path,
            )

            # Fetch previous context
            prev_ctx = _fetch_previous_context(doc_id, page_num)

            # Stage 2: Text explanation
            text_prompt = build_text_explanation_prompt(
                page_num=page_num,
                question="请讲解这一页的内容",
                extraction_text=extraction_text,
                vision_extraction=vision_result,
                related_pages=[page_num],
                repeat_analysis=extract_payload.get("repeat_analysis"),
                previous_context=prev_ctx,
            )
            new_explanation = pipeline.text_gateway.generate_text_markdown(
                prompt=text_prompt,
            )

            print(f"  Vision extraction: {len(vision_result)} chars")
            print(f"  New explanation: {len(new_explanation)} chars")
            print(f"  Existing explanation: {len(existing_md or '')} chars")

            results.append({
                "file": filename,
                "page": page_num,
                "reason": reason,
                "status": "success",
                "vision_extraction": vision_result,
                "new_explanation": new_explanation,
                "existing_explanation": existing_md or "",
                "extraction_text_preview": extraction_text[:500],
            })
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({
                "file": filename,
                "page": page_num,
                "reason": reason,
                "status": "error",
                "error": str(e),
            })

    output_path = Path(__file__).resolve().parent / "eval_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n\nResults saved to {output_path}")
    print(f"Total: {len(results)} pages, {sum(1 for r in results if r['status'] == 'success')} successful")


if __name__ == "__main__":
    main()
