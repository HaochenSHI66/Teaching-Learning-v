from __future__ import annotations

import re

from sqlmodel import Session, select

from app.models import Slide, SlideExtract

TOKEN_PATTERN = re.compile(r"[a-z0-9_]{2,}")
# CJK Unified Ideographs range
_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]+")


def _tokenize(text: str) -> set[str]:
    tokens: set[str] = set()
    # ASCII tokens (existing behavior)
    tokens.update(TOKEN_PATTERN.findall(text.lower()))
    # Chinese character bigrams + individual chars for CJK text
    for match in _CJK_RE.finditer(text):
        chars = match.group()
        # Always add individual characters
        for c in chars:
            tokens.add(c)
        # Also add bigrams for multi-char runs
        for i in range(len(chars) - 1):
            tokens.add(chars[i : i + 2])
    return tokens


def retrieve_related_slides(
    *,
    session: Session,
    document_id: str,
    question: str,
    anchor_slide_id: str | None,
    max_results: int = 3,
) -> list[Slide]:
    slides = session.exec(
        select(Slide).where(Slide.document_id == document_id).order_by(Slide.page_num)
    ).all()
    if not slides:
        return []

    slide_ids = [slide.id for slide in slides]
    extracts = session.exec(select(SlideExtract).where(SlideExtract.slide_id.in_(slide_ids))).all()
    extract_map = {extract.slide_id: extract.payload for extract in extracts}

    question_tokens = _tokenize(question)
    scored: list[tuple[int, int, Slide]] = []

    for slide in slides:
        payload = extract_map.get(slide.id, {})
        text = f"{payload.get('summary', '')}\n{payload.get('text', '')}"
        content_tokens = _tokenize(text)
        overlap = len(question_tokens & content_tokens)

        if slide.id == anchor_slide_id:
            overlap += 1000

        if overlap > 0:
            scored.append((overlap, -slide.page_num, slide))

    if not scored and anchor_slide_id:
        fallback = next((slide for slide in slides if slide.id == anchor_slide_id), None)
        if fallback:
            return [fallback]

    scored.sort(reverse=True)
    selected = [slide for _, _, slide in scored[:max_results]]

    if anchor_slide_id and all(slide.id != anchor_slide_id for slide in selected):
        anchor = next((slide for slide in slides if slide.id == anchor_slide_id), None)
        if anchor:
            selected.insert(0, anchor)
            selected = selected[:max_results]

    return selected
