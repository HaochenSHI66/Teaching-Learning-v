from __future__ import annotations

import difflib
import logging
from pathlib import Path
import re

from app.models import Slide
from app.services.dual_pipeline import DualModelPipeline
from app.services.json_renderer import build_meta_from_json, render_explanation_json
from app.services.model_gateway import ModelGateway
from app.services.prompt_templates import (
    build_roi_explanation_prompt,
    build_slide_explanation_prompt,
    extract_bilingual_terms,
)

CURRENT_EXPLANATION_VERSION = 4
_PAGE_TYPE_COMMENT_RE = re.compile(
    r"<!--\s*page_type:\s*(title|toc|intro|content|example|summary)\s*-->",
)
_PLACEHOLDER_HEADING_RE = re.compile(
    r"^##\s*(?:Slide 标题|\[页面实际标题\]|Slide Title|Title)\s*$",
    flags=re.MULTILINE,
)
_DISALLOWED_SECTION_RE = re.compile(
    r"(?ms)^###\s*(?:1分钟自测|Quick Check|自测|Quiz)\b.*?(?=^##\s|^###\s|\Z)"
)
_CALLOUT_RE = re.compile(r"(?msi)^>\s*\[!(?:NOTE|TIP|WARNING|IMPORTANT)\]\s*\n(?:^>.*\n?)*")
_SECTION_RE = re.compile(r"^###\s+.+$", flags=re.MULTILINE)
_TOC_KEYWORDS = (
    "table of contents",
    "目录",
    "大纲",
    "提纲",
    "议程",
    "agenda",
    "outline",
    "roadmap",
    "topics",
    "contents",
    "overview",
)


def explanation_markdown_is_stale(markdown: str) -> bool:
    return bool(_PLACEHOLDER_HEADING_RE.search(markdown or ""))


def explanation_meta_is_current(meta: dict | None) -> bool:
    if not meta:
        return False
    render_mode = meta.get("render_mode")
    if render_mode == "compact-static":
        return bool(meta.get("content_type") and meta.get("title"))
    if render_mode in ("repeat-aware", "outline", "outline-json"):
        sections = meta.get("sections") or {}
        return bool(sections.get("translation_md"))
    return False


def _best_title(*, slide: Slide, extracted_text: str, extract_payload: dict | None) -> str:
    payload = extract_payload or {}
    for candidate in payload.get("title_candidates") or []:
        cleaned = str(candidate).strip()
        if cleaned:
            return cleaned

    summary = str(payload.get("summary") or "").strip()
    if summary:
        return summary

    for line in extracted_text.splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned[:120]

    return f"Slide {slide.page_num}"


def _fix_bold_spacing(markdown: str) -> str:
    """Fix bold markdown issues from LLM output so ReactMarkdown renders correctly.

    1. `** text**` → `**text**`  (space after opening **)
    2. `**text**：` → `**text** ：` (colon stuck to closing ** breaks rendering)
    3. `**text**中文` → `**text** 中文` (CJK stuck to closing **)
    """
    # Fix opening ** followed by space
    cleaned = re.sub(r'\*\*\s+([^*]+?)\*\*', r'**\1**', markdown)
    # Fix closing ** followed by ANY non-space character (colon, CJK, digits, etc.)
    # Insert a space so markdown parser can correctly close the bold
    cleaned = re.sub(r'\*\*([^*]+)\*\*(?=\S)', r'**\1** ', cleaned)
    return cleaned


def _strip_ai_filler(markdown: str) -> str:
    """Remove common AI filler lines that add no knowledge.

    Only strip lines that are short meta-commentary (≤40 chars after prefix).
    Longer lines likely carry real domain content even if they start with a
    filler prefix, e.g. "本页内容涉及TCP协议的三次握手过程".
    """
    _FILLER_PREFIXES = (
        "本页主要介绍",
        "本页内容",
        "本页是",
        "这页幻灯片",
        "这一页主要",
        "本页标题为",
        "页面标题为",
        "页面标题是",
        "本页没有",
        "本页内容没有",
    )
    lines = markdown.split("\n")
    cleaned = []
    for line in lines:
        stripped = line.strip()
        # Skip pure meta-commentary lines — but only if short enough to be
        # filler.  Lines longer than 40 chars after the prefix likely carry
        # real information (e.g. "本页内容涉及TCP协议的三次握手过程").
        is_filler = False
        for p in _FILLER_PREFIXES:
            if stripped.startswith(p):
                remainder = stripped[len(p):].strip("，。：:,. ")
                if len(remainder) <= 40:
                    is_filler = True
                break
        if is_filler:
            continue
        # Strip course info lines (handles **bold** wrapped keywords too)
        if re.match(r"^[-\s*]*(?:页码|课程编号|课件|学期|讲师|授课|幻灯片编号)", stripped):
            continue
        # Strip "页面顶部/底部蓝色横幅标明了..." type lines
        if re.match(r"^.*?(?:页面顶部|页面底部|页面上方|页面下方|蓝色横幅|页眉|页脚).*?(?:标明|标注|显示|标识|包含)", stripped):
            continue
        # Strip slide number references like "1 / 25（表示本课程课件共 25 页..."
        if re.match(r"^[-\s*]*(?:页码标识|Slide \d)", stripped):
            continue
        cleaned.append(line)
    return "\n".join(cleaned)


def _strip_backtick_code(markdown: str) -> str:
    """Remove inline backtick wrapping (` ... `) but keep the content."""
    # Remove inline code backticks but preserve content
    # Don't touch code blocks (``` ... ```)
    return re.sub(r'(?<!`)`([^`\n]+?)`(?!`)', r'\1', markdown)


def _extract_llm_page_type(markdown: str) -> str | None:
    """Extract page_type from LLM output comment like <!-- page_type: example -->."""
    match = _PAGE_TYPE_COMMENT_RE.search(markdown)
    return match.group(1) if match else None


def _strip_all_callouts(markdown: str) -> str:
    """Strip all Obsidian-style callout blocks."""
    return _CALLOUT_RE.sub("", markdown)


def _strip_disallowed_sections(markdown: str) -> str:
    cleaned = _DISALLOWED_SECTION_RE.sub("", markdown)
    cleaned = _strip_all_callouts(cleaned)
    # Strip the page_type comment line from final output
    cleaned = _PAGE_TYPE_COMMENT_RE.sub("", cleaned)
    cleaned = _strip_ai_filler(cleaned)
    cleaned = _strip_backtick_code(cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = _fix_bold_spacing(cleaned)
    return cleaned.strip()


def sanitize_slide_markdown(
    *,
    slide: Slide,
    markdown: str,
    extracted_text: str,
    extract_payload: dict | None,
) -> str:
    cleaned = markdown.strip()
    if not cleaned:
        return cleaned

    title = _best_title(slide=slide, extracted_text=extracted_text, extract_payload=extract_payload)
    if _PLACEHOLDER_HEADING_RE.search(cleaned):
        cleaned = _PLACEHOLDER_HEADING_RE.sub(f"## {title}", cleaned, count=1)

    if not re.search(r"^##\s+.+$", cleaned, flags=re.MULTILINE):
        cleaned = f"## {title}\n\n{cleaned}"

    return _strip_disallowed_sections(cleaned)


def sanitize_roi_markdown(markdown: str) -> str:
    cleaned = markdown.strip()
    if not cleaned:
        return cleaned
    return _strip_disallowed_sections(cleaned)


def _summary_from_text(extracted_text: str, question: str) -> str:
    cleaned = " ".join(extracted_text.split())
    if cleaned:
        return cleaned[:220]
    return f"页面文本有限，当前围绕“{question}”做保守讲解。"


def _extraction_text_for_prompt(extracted_text: str, extract_payload: dict | None) -> str:
    payload = extract_payload or {}
    lines: list[str] = []

    summary = str(payload.get("summary") or "").strip()
    if summary:
        lines.append(f"Summary: {summary}")

    title_candidates = [str(item).strip() for item in payload.get("title_candidates") or [] if str(item).strip()]
    if title_candidates:
        lines.append("Title Candidates:")
        lines.extend(f"- {item}" for item in title_candidates[:3])

    for label, key in (
        ("Text Blocks", "text_blocks"),
        ("Bullet Blocks", "bullet_blocks"),
        ("Figures", "figures"),
        ("Tables", "tables"),
        ("Equation Blocks", "equation_like_blocks"),
        ("Code Blocks", "code_like_blocks"),
    ):
        blocks = payload.get(key) or []
        if not blocks:
            continue
        lines.append(f"{label}:")
        for block in blocks[:5]:
            text = str(block.get("text") or block.get("label") or "").strip()
            if text:
                lines.append(f"- {text}")

    repeat_analysis = payload.get("repeat_analysis") or {}
    if repeat_analysis:
        lines.append("Repeat Analysis:")
        lines.append(f"- status: {repeat_analysis.get('status') or 'unknown'}")
        lines.append(f"- window_pages: {repeat_analysis.get('window_pages') or []}")
        lines.append(f"- repeat_pages: {repeat_analysis.get('repeat_pages') or []}")
        lines.append(f"- repeated_ratio: {repeat_analysis.get('repeated_ratio') or 0}")
        repeated_blocks = repeat_analysis.get("repeated_blocks") or []
        if repeated_blocks:
            lines.append("- repeated_blocks:")
            for item in repeated_blocks[:5]:
                lines.append(
                    f"  - current={item.get('current_block_id')} source_page={item.get('source_page_num')} text={item.get('current_excerpt')}"
                )

    if extracted_text.strip():
        lines.append("Raw Extracted Text:")
        lines.append(extracted_text.strip())

    return "\n".join(lines).strip() or "（无稳定结构化提取结果）"


def _looks_like_example_page(*, extracted_text: str, question: str, extract_payload: dict | None) -> bool:
    payload = extract_payload or {}
    haystack = "\n".join(
        [
            extracted_text,
            question,
            str(payload.get("summary") or ""),
            " ".join(str(item) for item in payload.get("title_candidates") or []),
        ]
    ).lower()
    keywords = (
        "example",
        "worked example",
        "exercise",
        "solution",
        "solve",
        "problem",
        "例题",
        "题目",
        "解答",
        "求解",
    )
    return any(keyword in haystack for keyword in keywords)


def _terms_sentence(extracted_text: str) -> str:
    pairs = extract_bilingual_terms(extracted_text)
    if not pairs:
        return "核心概念（Key Concept）"
    return "、".join(f"{chinese}（{english}）" for chinese, english in pairs[:4])


def _payload_blocks(extract_payload: dict | None, key: str) -> list[dict]:
    return list((extract_payload or {}).get(key) or [])


def _normalized_lines(extract_payload: dict | None) -> list[str]:
    lines: list[str] = []
    for key in ("text_blocks", "bullet_blocks"):
        for block in _payload_blocks(extract_payload, key):
            text = str(block.get("text") or "").strip()
            if text:
                lines.append(text.lstrip("-*• ").strip())
    return lines


def _looks_like_toc_page(*, extracted_text: str, extract_payload: dict | None) -> bool:
    """Check if page is a TOC — only match keywords in title/summary, not body text."""
    payload = extract_payload or {}
    # Only check title candidates and summary, NOT the full extracted text
    title_and_summary = " ".join(
        [
            str(payload.get("summary") or ""),
            " ".join(str(item) for item in payload.get("title_candidates") or []),
        ]
    ).lower()
    has_keyword = any(keyword in title_and_summary for keyword in _TOC_KEYWORDS)
    if not has_keyword:
        return False
    # Even if title matches, pages with substantial content are not TOC
    word_count = len(extracted_text.split())
    if word_count > 30:
        return False
    return True


def _detect_compact_slide_type(*, extracted_text: str, extract_payload: dict | None) -> str | None:
    payload = extract_payload or {}
    page_stats = payload.get("page_stats") or {}
    word_count = int(page_stats.get("word_count") or len(extracted_text.split()))
    text_blocks = _payload_blocks(payload, "text_blocks")
    bullet_blocks = _payload_blocks(payload, "bullet_blocks")
    title_candidates = [str(item).strip() for item in payload.get("title_candidates") or [] if str(item).strip()]
    has_dense_content = any(
        _payload_blocks(payload, key)
        for key in ("equation_like_blocks", "code_like_blocks", "tables", "figures")
    )
    if has_dense_content:
        return None
    if _looks_like_toc_page(extracted_text=extracted_text, extract_payload=payload):
        return "toc"
    if not text_blocks and not title_candidates:
        return None
    title_like_line = title_candidates[0] if title_candidates else str(text_blocks[0].get("text") or "").strip()
    title_like_word_count = len(title_like_line.split())
    has_topic_punctuation = any(marker in title_like_line for marker in (":", ";", ","))
    if (
        word_count <= 6
        and title_like_word_count <= 4
        and len(text_blocks) <= 2
        and not bullet_blocks
        and len(_payload_blocks(payload, "figures")) <= 1
        and not has_topic_punctuation
    ):
        return "title"
    return None


def _build_compact_slide_explanation(
    *,
    slide: Slide,
    extracted_text: str,
    extract_payload: dict | None,
    compact_type: str,
) -> tuple[str, dict]:
    title = _best_title(slide=slide, extracted_text=extracted_text, extract_payload=extract_payload)
    lines = [f"## {title}"]

    if compact_type == "toc":
        outline_items = []
        for item in _normalized_lines(extract_payload):
            if item == title:
                continue
            if item not in outline_items:
                outline_items.append(item)
        if outline_items:
            lines.extend(["", *[f"- {item}" for item in outline_items[:12]]])

    markdown = "\n".join(lines).strip()
    meta = {
        "render_mode": "compact-static",
        "content_type": compact_type,
        "title": title,
        "compact_md": markdown,
    }
    return markdown, meta


def _split_sections(markdown: str) -> dict[str, str]:
    matches = list(_SECTION_RE.finditer(markdown))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        section_md = markdown[start:end].strip()
        heading = match.group(0).strip()
        sections[heading] = section_md
    return sections


_HEADING_ALIASES = {
    "讲解": ["完整翻译与解释", "翻译与解释", "完整翻译", "翻译解释", "内容翻译", "讲解内容", "内容讲解", "这页讲什么"],
    "逐点讲解": ["逐条讲解", "详细讲解", "分点讲解"],
    "本页关键结论": ["关键结论", "核心结论", "本页结论", "结论"],
    "例题讲解": ["例题完整讲解", "例题解析", "习题讲解", "解题过程"],
    "题目分析": ["题目条件", "已知条件", "问题分析"],
    "解题过程": ["解题步骤", "求解过程", "解法"],
    "知识点总结": ["知识点归纳", "知识点梳理", "核心知识点", "知识总结", "要点总结"],
    "知识点摘要": ["知识摘要", "摘要", "要点摘要", "快速复习"],
    "重复部分讲解": ["重复内容", "重复讲解", "回顾"],
}


def _fuzzy_section_get(sections: dict[str, str], target: str) -> str | None:
    """Find a section by fuzzy heading match. Returns content or None."""
    # Strip ### prefix for comparison
    clean_target = target.lstrip("# ").strip()

    # Try exact match first
    if target in sections:
        return sections[target]

    # Try normalized match (strip whitespace, ignore trailing punctuation)
    for key, value in sections.items():
        clean_key = key.lstrip("# ").strip().rstrip("：:。.")
        if clean_key == clean_target or clean_key == clean_target.rstrip("：:。."):
            return value

    # Try alias match before fuzzy fallback
    aliases = _HEADING_ALIASES.get(clean_target, [])
    for key, value in sections.items():
        clean_key = key.lstrip("# ").strip().rstrip("：:。.")
        if clean_key in aliases:
            return value

    # Try containment (target is substring of key, or key of target)
    for key, value in sections.items():
        clean_key = key.lstrip("# ").strip()
        if clean_target in clean_key or clean_key in clean_target:
            return value

    # Try fuzzy ratio
    best_match = None
    best_ratio = 0.0
    for key, value in sections.items():
        clean_key = key.lstrip("# ").strip()
        ratio = difflib.SequenceMatcher(None, clean_target, clean_key).ratio()
        if ratio > best_ratio and ratio >= 0.7:
            best_ratio = ratio
            best_match = value

    return best_match


def _build_repeat_summary(extract_payload: dict | None) -> dict:
    repeat_analysis = (extract_payload or {}).get("repeat_analysis") or {}
    repeat_pages = [int(page) for page in repeat_analysis.get("repeat_pages") or []]
    repeated_ratio = float(repeat_analysis.get("repeated_ratio") or 0.0)
    has_repeat_section = bool(
        repeat_pages
        and (
            repeated_ratio >= 0.30
            or len(repeat_analysis.get("repeated_block_ids") or []) >= 2
        )
    )
    return {
        "repeat_pages": repeat_pages,
        "repeated_ratio": round(repeated_ratio, 4),
        "has_repeat_section": has_repeat_section,
    }


def _build_translation_fallback(*, summary: str, extracted_text: str, terms: str) -> str:
    if not extracted_text.strip():
        return "### 讲解\n\n本页解析生成失败，请点击「生成解析」重试。"
    excerpt = " ".join(extracted_text.split())[:600]
    return (
        f"### 讲解\n\n"
        f"**注意：本页为文本回退版本，建议重新生成以获得完整讲解。**\n\n"
        f"页面提取到的主要内容：\n\n{excerpt}"
    )


def _build_primary_fallback(
    *,
    is_example: bool,
    repeat_summary: dict,
    extracted_text: str,
    question: str,
) -> tuple[str, str]:
    # No more template boilerplate — just return empty and let the
    # translation/main content section carry the explanation.
    content_type = "example" if is_example else (
        "transition" if len(extracted_text.split()) < 8 else "concept"
    )
    return (content_type, "")


def _extract_outline_title(cleaned: str) -> str | None:
    """Extract title from outline format: '## 第 N 页：主题' → '主题'."""
    match = re.search(r"^##\s*第\s*\d+\s*页[：:]\s*(.+)$", cleaned, flags=re.MULTILINE)
    if match:
        return match.group(1).strip()
    return None


def _is_outline_format(cleaned: str) -> bool:
    """Check if LLM output is in the new outline format (no ### subsections)."""
    has_outline_title = bool(re.search(r"^##\s*第\s*\d+\s*页[：:]", cleaned, flags=re.MULTILINE))
    has_subsections = bool(re.search(r"^###\s+", cleaned, flags=re.MULTILINE))
    return has_outline_title or not has_subsections


def _canonicalize_slide_explanation(
    *,
    slide: Slide,
    markdown: str,
    extracted_text: str,
    extract_payload: dict | None,
    related_pages: list[int],
    question: str,
) -> tuple[str, dict]:
    # Extract LLM's page_type judgment before sanitization strips it
    llm_page_type = _extract_llm_page_type(markdown)

    cleaned = sanitize_slide_markdown(
        slide=slide,
        markdown=markdown,
        extracted_text=extracted_text,
        extract_payload=extract_payload,
    )
    title = _best_title(slide=slide, extracted_text=extracted_text, extract_payload=extract_payload)
    repeat_summary = _build_repeat_summary(extract_payload)

    is_example = _looks_like_example_page(
        extracted_text=extracted_text,
        question=question,
        extract_payload=extract_payload,
    )
    if llm_page_type == "example":
        is_example = True

    # ── New outline format: no ### subsections, just ## title + bullets ──
    if _is_outline_format(cleaned):
        outline_title = _extract_outline_title(cleaned)
        if outline_title:
            title = outline_title

        # Strip the ## heading line, keep the rest as body
        lines = cleaned.split("\n")
        body_lines = [l for l in lines if not re.match(r"^##\s+", l)]
        body_md = "\n".join(body_lines).strip()

        if not body_md:
            body_md = _build_translation_fallback(
                summary=_summary_from_text(extracted_text, question),
                extracted_text=extracted_text,
                terms=_terms_sentence(extracted_text),
            )

        content_type = (
            "example" if is_example
            else llm_page_type if llm_page_type in ("title", "toc", "intro", "summary")
            else "concept"
        )

        canonical_markdown = f"## 第 {slide.page_num} 页：{title}\n\n{body_md}"

        meta = {
            "render_mode": "outline",
            "content_type": content_type,
            "title": title,
            "repeat_summary": repeat_summary,
            "sections": {
                "translation_md": body_md,
                "primary_md": "",
                "repeat_md": "",
                "summary_md": "",
            },
            "concepts": [],
        }
        return canonical_markdown, meta

    # ── Legacy card format: ### subsections (backward compat) ──
    sections = _split_sections(cleaned)
    translation_md = _fuzzy_section_get(sections, "### 讲解")
    detail_md = _fuzzy_section_get(sections, "### 逐点讲解")
    conclusion_md = _fuzzy_section_get(sections, "### 本页关键结论")
    if translation_md and (detail_md or conclusion_md):
        parts = [translation_md.strip()]
        if detail_md:
            parts.append(detail_md.strip())
        if conclusion_md:
            parts.append(conclusion_md.strip())
        translation_md = "\n\n".join(parts)
    elif not translation_md and (detail_md or conclusion_md):
        parts = []
        if detail_md:
            parts.append(detail_md.strip())
        if conclusion_md:
            parts.append(conclusion_md.strip())
        translation_md = "\n\n".join(parts)
    example_md = (
        _fuzzy_section_get(sections, "### 例题讲解")
        or _fuzzy_section_get(sections, "### 例题完整讲解")
        or _fuzzy_section_get(sections, "### 解题过程")
    )
    concept_md = _fuzzy_section_get(sections, "### 知识点总结")
    summary_md = _fuzzy_section_get(sections, "### 知识点摘要")
    concepts_md = _fuzzy_section_get(sections, "### 本页概念")
    repeat_md = _fuzzy_section_get(sections, "### 重复部分讲解")
    problem_analysis_md = _fuzzy_section_get(sections, "### 题目分析")

    if not translation_md and not example_md and not concept_md and len(cleaned) > 20:
        lines = cleaned.split("\n")
        body_lines = [l for l in lines if not l.startswith("## ")]
        translation_md = "\n".join(body_lines).strip()

    terms = _terms_sentence(extracted_text)
    summary = _summary_from_text(extracted_text, question)

    if not translation_md:
        translation_md = _build_translation_fallback(
            summary=summary,
            extracted_text=extracted_text,
            terms=terms,
        )

    if problem_analysis_md and example_md:
        example_md = problem_analysis_md.strip() + "\n\n" + example_md.strip()
    elif problem_analysis_md and not example_md:
        example_md = problem_analysis_md

    if example_md or (llm_page_type == "example" and is_example):
        content_type = "example"
        primary_md = example_md or ""
    elif concept_md:
        content_type = "concept"
        primary_md = concept_md
    elif llm_page_type in ("title", "toc", "intro", "summary"):
        content_type = llm_page_type
        primary_md = ""
    elif translation_md and len(translation_md) > 100:
        content_type = "concept"
        primary_md = ""
    else:
        content_type, primary_md = _build_primary_fallback(
            is_example=is_example,
            repeat_summary=repeat_summary,
            extracted_text=extracted_text,
            question=question,
        )

    canonical_parts = [
        f"## {title}",
        "",
        translation_md.strip(),
    ]
    if primary_md and primary_md.strip():
        canonical_parts.extend(["", primary_md.strip()])
    if repeat_md:
        canonical_parts.extend(["", repeat_md.strip()])

    canonical_markdown = "\n".join(part for part in canonical_parts if part is not None).strip()
    extracted_concepts = []
    if concepts_md:
        for line in concepts_md.split("\n"):
            line = line.strip().lstrip("-•* ")
            if "|" in line and not line.startswith("#"):
                parts = [p.strip() for p in line.split("|")]
                if len(parts) >= 3 and parts[0] and parts[1]:
                    extracted_concepts.append({
                        "name_en": parts[0],
                        "name_zh": parts[1],
                        "description": parts[2] if len(parts) > 2 else "",
                    })

    meta = {
        "render_mode": "repeat-aware",
        "content_type": content_type,
        "title": title,
        "repeat_summary": repeat_summary,
        "sections": {
            "translation_md": translation_md.strip(),
            "primary_md": primary_md.strip(),
            "repeat_md": repeat_md.strip() if repeat_md else "",
            "summary_md": summary_md.strip() if summary_md else "",
        },
        "concepts": extracted_concepts,
    }
    return canonical_markdown, meta


def _template_slide_explanation(
    *,
    slide: Slide,
    question: str,
    extracted_text: str,
    extract_payload: dict | None,
    related_pages: list[int],
) -> tuple[str, dict]:
    canonical_markdown, meta = _canonicalize_slide_explanation(
        slide=slide,
        markdown="",
        extracted_text=extracted_text,
        extract_payload=extract_payload,
        related_pages=related_pages,
        question=question,
    )
    return canonical_markdown, meta


def _template_roi_explanation(
    *,
    slide: Slide,
    question: str,
    extracted_text: str,
    extract_payload: dict | None,
    roi_bbox: tuple[float, float, float, float],
    region_size: tuple[int, int],
) -> str:
    x, y, w, h = roi_bbox
    region_width, region_height = region_size
    summary = _summary_from_text(extracted_text, question)
    is_example = _looks_like_example_page(
        extracted_text=extracted_text,
        question=question,
        extract_payload=extract_payload,
    )
    section_title = "例题完整讲解" if is_example else "区域知识点总结"
    explanation = (
        "当前为文本回退讲解，只依据区域对应的稳定提取文本做保守说明。"
        "如果框选里真正关键的信息来自图像细节、颜色、箭头或公式排版，而这些内容没有被稳定提取到，"
        "那这份解释只能先给出一个可靠下限，不会伪造更具体的结论。"
    )

    if is_example:
        deep_dive = (
            "从可见文字判断，这个区域更像例题或解题步骤。阅读时先抓题目条件和目标，"
            "再顺着页面的推导顺序看每一步为什么成立，重点检查每一步是否使用了前面已经给出的条件或公式。"
        )
    else:
        deep_dive = (
            "从可见文字判断，这个区域更像概念、公式或图示说明。理解时要先认出它在整页中的角色，"
            "再看它是在定义概念、补充条件、解释图示，还是承接前后页的过渡内容。"
        )

    return (
        f"## 区域解释（第 {slide.page_num} 页）\n\n"
        f"**区域坐标**：`x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f}`\n"
        f"**区域像素**：`{region_width} x {region_height}`\n\n"
        "### 区域内容翻译与解释\n\n"
        f"{explanation} 当前区域能稳定识别的内容主要集中在 <mark>{summary}</mark>。\n\n"
        f"### {section_title}\n\n"
        f"{deep_dive}\n"
    )


def generate_slide_explanation(
    *,
    slide: Slide,
    question: str,
    extracted_text: str = "",
    slide_image_path: Path | None = None,
    extract_payload: dict | None = None,
    gateway: ModelGateway | None = None,
    related_pages: list[int] | None = None,
) -> tuple[str, list[str], bool, dict]:
    related_pages = related_pages or [slide.page_num]
    follow_ups = [
        "把这页和前一页串起来讲一遍",
        "把这页最难的公式再展开解释",
        "给我一个更直觉的理解方式",
    ]
    compact_type = _detect_compact_slide_type(
        extracted_text=extracted_text,
        extract_payload=extract_payload,
    )
    if compact_type:
        markdown, meta = _build_compact_slide_explanation(
            slide=slide,
            extracted_text=extracted_text,
            extract_payload=extract_payload,
            compact_type=compact_type,
        )
        return markdown, follow_ups, False, meta

    prompt_extraction_text = _extraction_text_for_prompt(extracted_text, extract_payload)
    prompt_contract = build_slide_explanation_prompt(
        page_num=slide.page_num,
        question=question,
        extracted_text=prompt_extraction_text,
        related_pages=related_pages,
        repeat_analysis=(extract_payload or {}).get("repeat_analysis"),
    )

    degraded = False
    logger = logging.getLogger(__name__)

    if slide_image_path:
        dual = DualModelPipeline()
        if dual.is_configured():
            # JSON pipeline (primary — structured output)
            try:
                json_data = dual.generate_json(
                    slide_image_path=slide_image_path,
                    extraction_text=prompt_extraction_text,
                    page_num=slide.page_num,
                    question=question,
                    related_pages=related_pages,
                    repeat_analysis=(extract_payload or {}).get("repeat_analysis"),
                    document_id=slide.document_id,
                )
                if json_data and isinstance(json_data, dict) and json_data.get("items"):
                    canonical_markdown = render_explanation_json(json_data)
                    meta = build_meta_from_json(json_data)
                    meta["pipeline"] = "dual-json"
                    return canonical_markdown, follow_ups, degraded, meta
                else:
                    logger.error("JSON pipeline returned empty/invalid data for page %d", slide.page_num)
            except Exception as exc:
                logger.error("JSON pipeline failed for page %d: %s", slide.page_num, exc)

            # If JSON failed, raise — no Markdown fallback
            raise RuntimeError(
                f"JSON pipeline failed for page {slide.page_num}. "
                "Markdown fallback is disabled."
            )

    # No image path — template fallback only (compact slides already handled above)
    answer, meta = _template_slide_explanation(
        slide=slide,
        question=question,
        extracted_text=extracted_text,
        extract_payload=extract_payload,
        related_pages=related_pages,
    )
    meta["pipeline"] = "template"
    return answer, follow_ups, degraded, meta


def generate_roi_explanation(
    *,
    slide: Slide,
    question: str,
    extracted_text: str = "",
    slide_image_path: Path | None = None,
    roi_image_path: Path | None = None,
    extract_payload: dict | None = None,
    gateway: ModelGateway | None = None,
    roi_bbox: tuple[float, float, float, float],
    region_size: tuple[int, int],
) -> tuple[str, bool]:
    prompt_extraction_text = _extraction_text_for_prompt(extracted_text, extract_payload)
    prompt_contract = build_roi_explanation_prompt(
        page_num=slide.page_num,
        question=question,
        extracted_text=prompt_extraction_text,
        roi_bbox=roi_bbox,
        region_size=region_size,
    )
    degraded = False
    if slide_image_path and roi_image_path:
        live_gateway = gateway or ModelGateway()
        try:
            answer = live_gateway.generate_roi_markdown(
                prompt=prompt_contract,
                slide_image_path=slide_image_path,
                roi_image_path=roi_image_path,
                extraction_text=prompt_extraction_text,
            )
            return sanitize_roi_markdown(answer), degraded
        except Exception as exc:
            logging.getLogger(__name__).warning("ROI pipeline failed, falling back to template: %s", exc)
            degraded = True

    answer = _template_roi_explanation(
        slide=slide,
        question=question,
        extracted_text=extracted_text,
        extract_payload=extract_payload,
        roi_bbox=roi_bbox,
        region_size=region_size,
    )
    return sanitize_roi_markdown(answer), degraded
