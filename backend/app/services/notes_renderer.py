"""Service for gathering export data and rendering styled study notes."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import markdown as _md
from jinja2 import Environment, FileSystemLoader
from sqlmodel import Session, select

from app.models import (
    Concept,
    ConceptRelation,
    Document,
    Flashcard,
    Slide,
    SlideExplanation,
    SlideExtract,
)
from app.services.model_gateway import ModelGateway

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Style metadata
# ---------------------------------------------------------------------------

STYLE_META: list[dict[str, str]] = [
    {
        "id": "modern-minimal",
        "name": "Modern Minimal",
        "name_zh": "现代简约",
        "description": "Clean layout with generous whitespace and accent borders",
        "color_primary": "#1a1a2e",
        "color_accent": "#4361ee",
    },
    {
        "id": "warm-notebook",
        "name": "Warm Notebook",
        "name_zh": "暖色笔记",
        "description": "Warm tones with a hand-written notebook feel",
        "color_primary": "#5c4033",
        "color_accent": "#e07a3a",
    },
    {
        "id": "clean-academic",
        "name": "Clean Academic",
        "name_zh": "学术经典",
        "description": "Traditional academic style with serif headings",
        "color_primary": "#2c3e50",
        "color_accent": "#27ae60",
    },
]

VALID_STYLES: set[str] = {s["id"] for s in STYLE_META}

# ---------------------------------------------------------------------------
# LLM prompt for study summary
# ---------------------------------------------------------------------------

SUMMARY_PROMPT = """\
根据以下课件页面标题和关键术语，写一段学习总结（中文）。

要求：
1. 用 3-4 句话概括本节课的核心主题
2. 点明最重要的 2-3 个概念之间的关系
3. 最后一句给出复习建议（重点看什么、什么容易混淆）
4. 总字数 100-180 字
5. 直接输出段落，不要标题、序号、bullet

页面标题：
{titles}

关键术语：
{terms}"""

# ---------------------------------------------------------------------------
# Template directory
# ---------------------------------------------------------------------------

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"

_MD_EXTENSIONS = ["tables", "fenced_code", "nl2br", "sane_lists"]


def _md_to_html(text: str) -> str:
    """Convert a Markdown string to HTML. Returns empty string for empty input."""
    if not text or not text.strip():
        return ""
    return _md.markdown(text, extensions=_MD_EXTENSIONS)


# ---------------------------------------------------------------------------
# Helper: extract structured items from SlideExtract payload
# ---------------------------------------------------------------------------

def _extract_items_from_payload(payload: dict) -> dict[str, list[dict]]:
    """Pull key_terms, formulas, and key_points from extraction blocks."""
    key_terms: list[dict] = []
    formulas: list[dict] = []
    key_points: list[dict] = []

    for block in payload.get("blocks", []):
        btype = block.get("type", "")
        text = block.get("text", "")
        if not text:
            continue
        entry = {"text": text, "label": block.get("label", "")}
        if btype == "key_term":
            key_terms.append(entry)
        elif btype == "formula":
            formulas.append(entry)
        elif btype in ("bullet_list", "bullet"):
            key_points.append(entry)

    return {
        "key_terms": key_terms,
        "formulas": formulas,
        "key_points": key_points,
    }


# ---------------------------------------------------------------------------
# Generate a short study summary via LLM
# ---------------------------------------------------------------------------

def _generate_study_summary(
    titles: list[str],
    terms: list[str],
) -> str:
    """Make ONE LLM call to produce a 3-5 sentence study summary.

    Returns an empty string on any failure so callers can gracefully degrade.
    """
    try:
        gw = ModelGateway()
        if not gw.is_configured():
            return ""
        prompt = SUMMARY_PROMPT.format(
            titles="\n".join(f"- {t}" for t in titles) if titles else "(none)",
            terms=", ".join(terms[:40]) if terms else "(none)",
        )
        return gw.generate_text_markdown(prompt=prompt)
    except Exception:
        logger.warning("Study summary generation failed", exc_info=True)
        return ""


# ---------------------------------------------------------------------------
# Gather all data needed for export
# ---------------------------------------------------------------------------

def gather_export_data(
    session: Session,
    document_id: str,
    *,
    include_images: bool = True,
    include_explanations: bool = True,
    include_key_terms: bool = True,
    include_knowledge_map: bool = True,
    include_flashcards: bool = True,
) -> dict[str, Any]:
    """Query the DB for everything needed to render export notes.

    Returns a plain dict suitable for passing into a Jinja2 template.
    """
    # -- Document ----------------------------------------------------------
    doc = session.get(Document, document_id)
    if doc is None:
        raise ValueError(f"Document {document_id} not found")

    # -- Slides (ordered) --------------------------------------------------
    slides = session.exec(
        select(Slide)
        .where(Slide.document_id == document_id)
        .order_by(Slide.page_num)
    ).all()
    slide_by_id: dict[str, Slide] = {s.id: s for s in slides}

    # -- Explanations (keyed by slide_id) ----------------------------------
    explanations_map: dict[str, SlideExplanation] = {}
    if include_explanations:
        explanations = session.exec(
            select(SlideExplanation)
            .where(SlideExplanation.document_id == document_id)
            .order_by(SlideExplanation.page_num)
        ).all()
        for exp in explanations:
            explanations_map[exp.slide_id] = exp

    # -- Extractions (keyed by slide_id) -----------------------------------
    extractions_map: dict[str, SlideExtract] = {}
    for slide in slides:
        ext = session.exec(
            select(SlideExtract).where(SlideExtract.slide_id == slide.id)
        ).first()
        if ext is not None:
            extractions_map[slide.id] = ext

    # -- Concepts ----------------------------------------------------------
    concepts: list[Concept] = []
    relations: list[ConceptRelation] = []
    if include_knowledge_map:
        concepts = list(session.exec(
            select(Concept)
            .where(Concept.document_id == document_id)
            .order_by(Concept.importance.desc())  # type: ignore[union-attr]
        ).all())
        relations = list(session.exec(
            select(ConceptRelation)
            .where(ConceptRelation.document_id == document_id)
        ).all())

    # -- Flashcards --------------------------------------------------------
    flashcards: list[Flashcard] = []
    if include_flashcards:
        flashcards = list(session.exec(
            select(Flashcard)
            .where(Flashcard.document_id == document_id)
            .order_by(Flashcard.slide_id)
        ).all())

    # -- Build per-slide data ----------------------------------------------
    all_titles: list[str] = []
    all_key_terms: list[str] = []
    slides_data: list[dict[str, Any]] = []

    for slide in slides:
        slide_dict: dict[str, Any] = {
            "id": slide.id,
            "page_num": slide.page_num,
            "image_path": slide.image_path if include_images else None,
            "thumbnail_path": slide.thumbnail_path if include_images else None,
        }

        # Extraction data
        ext = extractions_map.get(slide.id)
        if ext is not None:
            payload = ext.payload or {}
            title_candidates = payload.get("title_candidates", [])
            slide_dict["title"] = title_candidates[0] if title_candidates else f"Slide {slide.page_num}"
            all_titles.append(slide_dict["title"])

            if include_key_terms:
                items = _extract_items_from_payload(payload)
                slide_dict["key_terms"] = items["key_terms"]
                slide_dict["formulas"] = items["formulas"]
                slide_dict["key_points"] = items["key_points"]
                all_key_terms.extend(t["text"] for t in items["key_terms"])
            else:
                slide_dict["key_terms"] = []
                slide_dict["formulas"] = []
                slide_dict["key_points"] = []
        else:
            slide_dict["title"] = f"Slide {slide.page_num}"
            slide_dict["key_terms"] = []
            slide_dict["formulas"] = []
            slide_dict["key_points"] = []

        # Explanation (convert MD → HTML for template)
        exp = explanations_map.get(slide.id)
        slide_dict["explanation"] = _md_to_html(exp.markdown) if exp else ""
        slide_dict["explanation_meta"] = exp.meta if exp else {}

        slides_data.append(slide_dict)

    # -- Study summary (single LLM call) -----------------------------------
    study_summary = _md_to_html(_generate_study_summary(all_titles, all_key_terms))

    # -- Concepts data for template ----------------------------------------
    concept_id_map = {c.id: c for c in concepts}
    concepts_data = [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "importance": c.importance,
            "slide_ids": c.slide_ids if isinstance(c.slide_ids, list) else [],
        }
        for c in concepts
    ]
    relations_data = [
        {
            "source_id": r.source_id,
            "target_id": r.target_id,
            "relation_type": r.relation_type,
            "source_name": concept_id_map[r.source_id].name if r.source_id in concept_id_map else "",
            "target_name": concept_id_map[r.target_id].name if r.target_id in concept_id_map else "",
        }
        for r in relations
    ]

    # -- Flashcards data ---------------------------------------------------
    flashcards_data = [
        {
            "id": fc.id,
            "slide_id": fc.slide_id,
            "front_md": _md_to_html(fc.front_md),
            "back_md": _md_to_html(fc.back_md),
            "page_num": slide_by_id[fc.slide_id].page_num if fc.slide_id in slide_by_id else 0,
        }
        for fc in flashcards
    ]

    return {
        "document_id": document_id,
        "filename": doc.filename,
        "title": Path(doc.filename).stem,
        "page_count": doc.page_count,
        "study_summary": study_summary,
        "slides": slides_data,
        "concepts": concepts_data,
        "concept_count": len(concepts_data),
        "relations": relations_data,
        "flashcards": flashcards_data,
    }


# ---------------------------------------------------------------------------
# Render HTML from gathered data
# ---------------------------------------------------------------------------

def render_notes_html(
    data: dict[str, Any],
    style: str = "modern-minimal",
    base_url: str = "",
) -> str:
    """Load the Jinja2 template, inject the chosen style CSS, and render HTML."""
    from datetime import date as _date

    if style not in VALID_STYLES:
        style = "modern-minimal"

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        autoescape=True,
    )
    template = env.get_template("study_notes.html")

    # Load the style CSS
    css_path = _TEMPLATE_DIR / "styles" / f"{style}.css"
    style_css = ""
    if css_path.exists():
        style_css = css_path.read_text(encoding="utf-8")

    # Find the style meta for the chosen style
    style_meta = next((s for s in STYLE_META if s["id"] == style), STYLE_META[0])

    html = template.render(
        **data,
        style_css=style_css,
        style_meta=style_meta,
        export_date=_date.today().isoformat(),
        base_url=base_url,
    )
    return html


# ---------------------------------------------------------------------------
# Render PDF from HTML
# ---------------------------------------------------------------------------

def render_notes_pdf(html: str) -> bytes:
    """Convert rendered HTML string to PDF bytes via WeasyPrint."""
    from weasyprint import HTML as WeasyHTML  # type: ignore[import-untyped]

    pdf_bytes: bytes = WeasyHTML(
        string=html,
        base_url=str(_TEMPLATE_DIR),
    ).write_pdf()
    return pdf_bytes
