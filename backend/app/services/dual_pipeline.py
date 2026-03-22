from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterable
from pathlib import Path

from app.services.model_gateway import ModelGateway
from app.services.prompt_templates import (
    build_vision_extraction_prompt,
    build_text_explanation_prompt,
)

logger = logging.getLogger(__name__)

# Max previous pages to include as context
_CONTEXT_WINDOW = 3


def _fetch_previous_context(document_id: str, page_num: int) -> str:
    """Fetch summary of recent previous slides from database for context."""
    try:
        import sqlite3
        db_path = os.getenv("DATABASE_URL", "storage/app.db")
        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            """
            SELECT se.page_num, se.meta
            FROM slideexplanation se
            WHERE se.document_id = ?
              AND se.page_num < ?
              AND se.page_num >= ?
            ORDER BY se.page_num DESC
            LIMIT ?
            """,
            (document_id, page_num, max(1, page_num - _CONTEXT_WINDOW), _CONTEXT_WINDOW),
        ).fetchall()
        conn.close()

        if not rows:
            return ""

        lines = []
        for row_page, meta_json in sorted(rows, key=lambda r: r[0]):
            meta = json.loads(meta_json) if meta_json else {}
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
