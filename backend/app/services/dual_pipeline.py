from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import Iterable
from pathlib import Path

from sqlalchemy import text as sa_text
from sqlmodel import Session

from app.db import create_db_engine, get_database_url
from app.services.model_gateway import ModelGateway
from app.services.prompt_templates import (
    build_vision_extraction_prompt,
    build_text_explanation_prompt,
    build_text_explanation_json_prompt,
)

logger = logging.getLogger(__name__)

# Max previous pages to include as context
_CONTEXT_WINDOW = 3

# Singleton engine for context fetching (avoid creating one per page)
_context_engine = None
_context_engine_lock = threading.Lock()


def _get_context_engine():
    global _context_engine
    if _context_engine is None:
        with _context_engine_lock:
            # Double-checked locking
            if _context_engine is None:
                _context_engine = create_db_engine(get_database_url())
    return _context_engine


def _fetch_previous_context(document_id: str, page_num: int) -> str:
    """Fetch summary of recent previous slides from database for context."""
    try:
        engine = _get_context_engine()
        with Session(engine) as session:
            stmt = sa_text(
                """
                SELECT se.page_num, se.meta
                FROM slideexplanation se
                WHERE se.document_id = :doc_id
                  AND se.page_num < :page_num
                  AND se.page_num >= :min_page
                ORDER BY se.page_num DESC
                LIMIT :limit
                """
            )
            rows = session.exec(
                stmt.bindparams(
                    doc_id=document_id,
                    page_num=page_num,
                    min_page=max(1, page_num - _CONTEXT_WINDOW),
                    limit=_CONTEXT_WINDOW,
                )
            ).all()

        if not rows:
            return ""

        lines = []
        for row_page, meta_raw in sorted(rows, key=lambda r: r[0]):
            if isinstance(meta_raw, str):
                try:
                    meta = json.loads(meta_raw) if meta_raw else {}
                except json.JSONDecodeError:
                    logger.warning("Malformed meta JSON for page %d, skipping", row_page)
                    meta = {}
            elif isinstance(meta_raw, dict):
                meta = meta_raw
            else:
                meta = {}
            title = meta.get("title", f"第 {row_page} 页")
            content_type = meta.get("content_type", "unknown")
            sections = meta.get("sections") or {}
            # Extract just the summary section if available
            summary = sections.get("summary_md", "")
            if not summary:
                # Fall back to first 150 chars of primary_md
                primary = sections.get("primary_md", "")
                summary = primary[:150] + "..." if len(primary) > 150 else primary
            lines.append(f"第 {row_page} 页「{title}」({content_type}): {summary}")

        return "\n".join(lines)
    except Exception as e:
        logger.warning("Failed to fetch previous context: %s", e)
        return ""


class DualModelPipeline:
    """Two-stage pipeline: vision model extracts → text model explains."""

    def __init__(
        self,
        *,
        vision_gateway: ModelGateway | None = None,
        text_gateway: ModelGateway | None = None,
    ) -> None:
        self.vision_gateway = vision_gateway or ModelGateway(
            api_key=os.getenv("VISION_API_KEY", ""),
            base_url=os.getenv("VISION_BASE_URL", ""),
            model=os.getenv("VISION_MODEL", ""),
            timeout=120.0,
        )
        self.text_gateway = text_gateway or ModelGateway(
            api_key=os.getenv("TEXT_API_KEY", ""),
            base_url=os.getenv("TEXT_BASE_URL", ""),
            model=os.getenv("TEXT_MODEL", ""),
            timeout=120.0,
        )

    def is_configured(self) -> bool:
        return self.vision_gateway.is_configured() and self.text_gateway.is_configured()

    def generate(
        self,
        *,
        slide_image_path: Path,
        extraction_text: str,
        page_num: int,
        question: str,
        related_pages: Iterable[int],
        repeat_analysis: dict | None = None,
        document_id: str = "",
    ) -> str:
        """Run the two-stage pipeline and return explanation markdown."""

        # Stage 1: Vision model reads the image
        vision_prompt = build_vision_extraction_prompt(
            extraction_text=extraction_text,
        )
        logger.info("Dual pipeline stage 1: vision extraction for page %d", page_num)
        vision_extraction = self.vision_gateway.generate_vision_extraction(
            prompt=vision_prompt,
            slide_image_path=slide_image_path,
        )
        logger.info(
            "Vision extraction complete: %d chars",
            len(vision_extraction),
        )

        # Fetch previous slide context for continuity
        previous_context = ""
        if document_id:
            previous_context = _fetch_previous_context(document_id, page_num)

        # Stage 2: Text model generates explanation
        text_prompt = build_text_explanation_prompt(
            page_num=page_num,
            question=question,
            extraction_text=extraction_text,
            vision_extraction=vision_extraction,
            related_pages=related_pages,
            repeat_analysis=repeat_analysis,
            previous_context=previous_context,
        )
        logger.info("Dual pipeline stage 2: text explanation for page %d", page_num)
        explanation = self.text_gateway.generate_text_markdown(
            prompt=text_prompt,
        )
        logger.info(
            "Text explanation complete: %d chars",
            len(explanation),
        )

        return explanation

    def generate_json(
        self,
        *,
        slide_image_path: Path,
        extraction_text: str,
        page_num: int,
        question: str,
        related_pages: Iterable[int],
        repeat_analysis: dict | None = None,
        document_id: str = "",
    ) -> dict | None:
        """Run two-stage pipeline returning structured JSON, or None on failure."""
        # Stage 1: Vision extraction (same as Markdown path)
        vision_prompt = build_vision_extraction_prompt(
            extraction_text=extraction_text,
        )
        logger.info("Dual pipeline JSON stage 1: vision extraction for page %d", page_num)
        vision_extraction = self.vision_gateway.generate_vision_extraction(
            prompt=vision_prompt,
            slide_image_path=slide_image_path,
        )
        logger.info("Vision extraction complete: %d chars", len(vision_extraction))

        previous_context = ""
        if document_id:
            previous_context = _fetch_previous_context(document_id, page_num)

        # Stage 2: Text model generates JSON
        text_prompt = build_text_explanation_json_prompt(
            page_num=page_num,
            question=question,
            extraction_text=extraction_text,
            vision_extraction=vision_extraction,
            related_pages=related_pages,
            repeat_analysis=repeat_analysis,
            previous_context=previous_context,
        )
        logger.info("Dual pipeline JSON stage 2: text JSON for page %d", page_num)
        try:
            result = self.text_gateway.generate_text_json(prompt=text_prompt)
            if not isinstance(result, dict) or "items" not in result:
                logger.warning("JSON output missing 'items' key, falling back")
                return None
            logger.info("JSON explanation complete: %d items", len(result.get("items", [])))
            return result
        except Exception as exc:
            logger.warning("JSON generation failed, will fall back to Markdown: %s", exc)
            return None
