#!/usr/bin/env python3
"""
Batch regenerate slide explanations using the dual-model pipeline.
Produces the new format with: page title heading, 知识点摘要 section, previous context.

Usage:
    cd backend && python3 ../scripts/batch_regenerate.py [--folder FOLDER_NAME] [--doc-id DOC_ID] [--dry-run]

Examples:
    python3 ../scripts/batch_regenerate.py --folder AMA1500
    python3 ../scripts/batch_regenerate.py --doc-id 4e69b011-9428-4f25-a179-0c3012b100fa
    python3 ../scripts/batch_regenerate.py  # all documents
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

_backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(_backend_dir))
os.chdir(_backend_dir)

from dotenv import load_dotenv
load_dotenv(_backend_dir / ".env", override=True)

from sqlmodel import Session, select
from app.db import create_db_engine, get_database_url
from app.models import Document, Folder, Slide, SlideExplanation, SlideExtract
from app.services.dual_pipeline import DualModelPipeline
from app.services.explanation_engine import (
    CURRENT_EXPLANATION_VERSION,
    _canonicalize_slide_explanation,
    _detect_compact_slide_type,
    _build_compact_slide_explanation,
    _extraction_text_for_prompt,
)


def regenerate_document(session: Session, pipeline: DualModelPipeline, doc: Document, dry_run: bool = False):
    """Regenerate all explanations for a document using the dual pipeline."""
    slides = session.exec(
        select(Slide).where(Slide.document_id == doc.id).order_by(Slide.page_num)
    ).all()

    if not slides:
        print(f"  No slides found, skipping")
        return 0

    regenerated = 0
    for slide in slides:
        # Skip if already has new format (summary_md exists)
        existing = session.exec(
            select(SlideExplanation).where(
                SlideExplanation.document_id == doc.id,
                SlideExplanation.slide_id == slide.id,
            )
        ).first()
        if existing and existing.meta:
            meta = existing.meta if isinstance(existing.meta, dict) else {}
            sections = meta.get("sections", {})
            if sections.get("summary_md") and meta.get("pipeline") == "dual":
                print(f"  Page {slide.page_num:3d}: SKIP (already new format)")
                regenerated += 1
                continue

        # Get extract payload
        extract = session.exec(
            select(SlideExtract).where(SlideExtract.slide_id == slide.id)
        ).first()
        if extract and extract.payload:
            extract_payload = json.loads(extract.payload) if isinstance(extract.payload, str) else extract.payload
        else:
            extract_payload = {}
        extracted_text = extract_payload.get("raw_text", "") if extract_payload else ""

        # Check compact type (title/toc pages don't need LLM)
        compact_type = _detect_compact_slide_type(
            extracted_text=extracted_text,
            extract_payload=extract_payload,
        )
        if compact_type:
            if not dry_run:
                markdown, meta = _build_compact_slide_explanation(
                    slide=slide,
                    extracted_text=extracted_text,
                    extract_payload=extract_payload,
                    compact_type=compact_type,
                )
                _upsert_explanation(session, doc.id, slide, markdown, meta)
            print(f"  Page {slide.page_num:3d}: compact ({compact_type})")
            regenerated += 1
            continue

        # Build extraction text for prompt
        prompt_extraction_text = _extraction_text_for_prompt(extracted_text, extract_payload)

        # Find slide image
        image_path = Path("storage") / doc.id / "slides" / f"slide_{slide.page_num:03d}.png"
        if not image_path.exists():
            print(f"  Page {slide.page_num:3d}: SKIP (no image)")
            continue

        if dry_run:
            print(f"  Page {slide.page_num:3d}: would regenerate")
            regenerated += 1
            continue

        try:
            answer = pipeline.generate(
                slide_image_path=image_path,
                extraction_text=prompt_extraction_text,
                page_num=slide.page_num,
                question="请讲解这一页的内容",
                related_pages=[slide.page_num],
                repeat_analysis=extract_payload.get("repeat_analysis"),
                document_id=doc.id,
            )

            canonical_markdown, meta = _canonicalize_slide_explanation(
                slide=slide,
                markdown=answer,
                extracted_text=extracted_text,
                extract_payload=extract_payload,
                related_pages=[slide.page_num],
                question="请讲解这一页的内容",
            )
            meta["pipeline"] = "dual"

            _upsert_explanation(session, doc.id, slide, canonical_markdown, meta)
            session.commit()

            has_summary = "summary_md" in (meta.get("sections") or {}) and meta["sections"]["summary_md"]
            print(f"  Page {slide.page_num:3d}: OK ({len(canonical_markdown)} chars, summary={'✓' if has_summary else '✗'})")
            regenerated += 1

            # Small delay to avoid rate limiting
            time.sleep(0.5)

        except Exception as e:
            print(f"  Page {slide.page_num:3d}: ERROR - {e}")
            continue

    return regenerated


def _upsert_explanation(session: Session, document_id: str, slide: Slide, markdown: str, meta: dict):
    """Insert or update a slide explanation."""
    existing = session.exec(
        select(SlideExplanation).where(
            SlideExplanation.document_id == document_id,
            SlideExplanation.slide_id == slide.id,
        )
    ).first()

    if existing:
        existing.markdown = markdown
        existing.meta = meta
        existing.version = CURRENT_EXPLANATION_VERSION
        session.add(existing)
    else:
        explanation = SlideExplanation(
            document_id=document_id,
            slide_id=slide.id,
            page_num=slide.page_num,
            markdown=markdown,
            meta=meta,
            version=CURRENT_EXPLANATION_VERSION,
        )
        session.add(explanation)


def main():
    parser = argparse.ArgumentParser(description="Batch regenerate slide explanations")
    parser.add_argument("--folder", help="Only regenerate documents in this folder")
    parser.add_argument("--doc-id", help="Only regenerate this specific document")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without calling LLM")
    args = parser.parse_args()

    engine = create_db_engine(get_database_url())
    pipeline = DualModelPipeline()

    if not pipeline.is_configured():
        print("ERROR: Dual pipeline not configured. Check .env")
        sys.exit(1)

    print(f"Vision model: {pipeline.vision_gateway.model}")
    print(f"Text model: {pipeline.text_gateway.model}")
    if args.dry_run:
        print("DRY RUN MODE - no LLM calls will be made\n")

    with Session(engine) as session:
        query = select(Document).order_by(Document.filename)
        if args.doc_id:
            query = query.where(Document.id == args.doc_id)
        elif args.folder:
            folder = session.exec(select(Folder).where(Folder.name == args.folder)).first()
            if not folder:
                print(f"ERROR: Folder '{args.folder}' not found")
                sys.exit(1)
            query = query.where(Document.folder_id == folder.id)

        docs = session.exec(query).all()
        print(f"Documents to process: {len(docs)}\n")

        total_regenerated = 0
        for i, doc in enumerate(docs, 1):
            print(f"\n[{i}/{len(docs)}] {doc.filename} ({doc.page_count} pages)")
            print("=" * 60)
            count = regenerate_document(session, pipeline, doc, dry_run=args.dry_run)
            total_regenerated += count
            if not args.dry_run:
                session.commit()

        print(f"\n\nDone! Regenerated {total_regenerated} pages across {len(docs)} documents.")


if __name__ == "__main__":
    main()
