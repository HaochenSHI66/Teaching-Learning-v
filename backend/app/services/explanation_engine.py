from __future__ import annotations

from pathlib import Path
import re

from app.models import Slide
from app.services.dual_pipeline import DualModelPipeline
from app.services.model_gateway import ModelGateway
from app.services.prompt_templates import (
    build_roi_explanation_prompt,
    build_slide_explanation_prompt,
    extract_bilingual_terms,
)

CURRENT_EXPLANATION_VERSION = 4
_PLACEHOLDER_HEADING_RE = re.compile(
    r"^##\s*(?:Slide 标题|\[页面实际标题\]|Slide Title|Title)\s*$",
    flags=re.MULTILINE,
)
_DISALLOWED_SECTION_RE = re.compile(
    r"(?ms)^###\s*(?:1分钟自测|Quick Check|自测|Quiz)\b.*?(?=^##\s|^###\s|\Z)"
)
_NOTE_CALLOUT_RE = re.compile(r"(?ms)^>\s*\[!NOTE\]\s*\n(?:^>.*\n?)*")
_SECTION_RE = re.compile(r"^###\s+.+$", flags=re.MULTILINE)
_TOC_KEYWORDS = (
    "agenda",
    "outline",
    "contents",
    "content",
    "roadmap",
    "overview",
    "table of contents",
    "目录",
    "大纲",
    "提纲",
    "议程",
)


def explanation_markdown_is_stale(markdown: str) -> bool:
    return bool(_PLACEHOLDER_HEADING_RE.search(markdown or ""))


def explanation_meta_is_current(meta: dict | None) -> bool:
    if not meta:
        return False
    render_mode = meta.get("render_mode")
    if render_mode == "compact-static":
        return bool(meta.get("content_type") and meta.get("title"))
    if render_mode != "repeat-aware":
        return False
    sections = meta.get("sections") or {}
    return bool(sections.get("translation_md") and sections.get("primary_md"))


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


def _strip_disallowed_sections(markdown: str) -> str:
    cleaned = _DISALLOWED_SECTION_RE.sub("", markdown)
    cleaned = _NOTE_CALLOUT_RE.sub("", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
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
    payload = extract_payload or {}
    summary_and_titles = " ".join(
        [
            str(payload.get("summary") or ""),
            " ".join(str(item) for item in payload.get("title_candidates") or []),
            extracted_text,
        ]
    ).lower()
    has_keyword = any(keyword in summary_and_titles for keyword in _TOC_KEYWORDS)
    return has_keyword


def _detect_compact_slide_type(*, extracted_text: str, extract_payload: dict | None) -> str | None:
    payload = extract_payload or {}
    page_stats = payload.get("page_stats") or {}
    word_count = int(page_stats.get("word_count") or len(extracted_text.split()))
    text_blocks = _payload_blocks(payload, "text_blocks")
    bullet_blocks = _payload_blocks(payload, "bullet_blocks")
    title_candidates = [str(item).strip() for item in payload.get("title_candidates") or [] if str(item).strip()]
    has_dense_content = any(
        _payload_blocks(payload, key)
        for key in ("equation_like_blocks", "code_like_blocks", "tables")
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


def _build_intro_meta(*, related_pages: list[int], repeat_summary: dict) -> str:
    citations = ", ".join(str(page) for page in sorted(set(related_pages))) or "无"
    lines = [f"**引用页码**：{citations}"]
    if repeat_summary["has_repeat_section"]:
        repeat_pages = ", ".join(str(page) for page in repeat_summary["repeat_pages"])
        percent = int(round(float(repeat_summary["repeated_ratio"]) * 100))
        lines.append(f"**重复占比**：{percent}%")
        lines.append(f"**重复来源**：第 {repeat_pages} 页")
    else:
        lines.append("**内容性质**：本页以新增或独立内容为主。")
    return "\n".join(lines)


def _build_translation_fallback(*, summary: str, extracted_text: str, terms: str) -> str:
    body = (
        "当前这份讲解是离线回退版本，只依据页面中稳定提取到的文字信息生成。"
        "如果原页里还有图示、表格、手写标注或公式细节没有被提取到，这里不会擅自补写，"
        "而是只把目前能确认的内容讲清楚。"
    )
    extracted_excerpt = " ".join(extracted_text.split())[:220]
    addition = f"当前页可稳定识别的内容主要包括：{extracted_excerpt}。" if extracted_excerpt else ""
    return (
        "### 完整翻译与解释\n\n"
        f"{body} 本页可稳定识别的关键信息主要围绕 <mark>{summary}</mark> 展开。"
        f"{addition} 最值得先抓住的术语包括 {terms}。"
        "阅读这一页时，应先把标题、正文和图示旁注连起来理解，不要把页面上的英文关键词当作孤立标签去背。"
    ).strip()


def _build_primary_fallback(
    *,
    is_example: bool,
    repeat_summary: dict,
    extracted_text: str,
    question: str,
) -> tuple[str, str]:
    if is_example:
        extra = (
            "本页和前面页面有明显重复，因此主讲部分只强调这次相对前文新增的步骤、条件变化或结论变化。"
            if repeat_summary["has_repeat_section"]
            else "本页内容以当前题目本身为主，应先把题意、条件和目标说清楚。"
        )
        return (
            "example",
            (
                "### 例题完整讲解\n\n"
                "从提取结果判断，这一页更像例题或示例页。理解时应先明确题目给定了什么、要求你求什么，"
                "再判断页面选择的解题方法为什么适用。"
                f"{extra}"
                "真正重要的不是把步骤机械抄下来，而是看清每一步是在利用什么前提、为什么能从上一步走到下一步。"
            ).strip(),
        )

    summary = _summary_from_text(extracted_text, question)
    extra = (
        "由于本页和前序页存在明显重复，主讲部分应优先盯住本页相对前文新增、补充或深化的知识点。"
        if repeat_summary["has_repeat_section"]
        else "这页主要应围绕当前页自身的定义、关系和图示来理解。"
    )
    content_type = "transition" if len(extracted_text.split()) < 8 else "concept"
    return (
        content_type,
        (
            "### 知识点总结\n\n"
            "从提取结果判断，这一页更像知识点说明页。真正需要掌握的，不只是表面上的术语翻译，"
            "而是这些概念为什么被引入、它们之间如何连接，以及页面里的公式、图示或定义分别承担什么角色。"
            f"{extra}"
            f"当前页可直接确认的主线可概括为：<mark>{summary}</mark>。"
        ).strip(),
    )


def _build_repeat_fallback(*, extract_payload: dict | None) -> str:
    repeat_analysis = (extract_payload or {}).get("repeat_analysis") or {}
    repeated_blocks = repeat_analysis.get("repeated_blocks") or []
    repeat_pages = [int(page) for page in repeat_analysis.get("repeat_pages") or []]
    if not repeat_pages:
        return ""

    unique_lines: list[str] = []
    seen: set[str] = set()
    for item in repeated_blocks:
        excerpt = str(item.get("current_excerpt") or "").strip()
        if not excerpt or excerpt in seen:
            continue
        unique_lines.append(excerpt)
        seen.add(excerpt)
        if len(unique_lines) >= 3:
            break

    repeat_pages_label = "、".join(f"第 {page} 页" for page in repeat_pages)
    body = (
        f"这一部分与前面的 {repeat_pages_label} 有明显重复，可以把它看作对前文核心内容的回顾。"
        "复习时重点重新确认这些重复内容的定义、条件和它在整套推导中的位置，"
        "不必把整页重新从头背一遍。"
    )
    if unique_lines:
        body += " 当前重复出现的核心内容包括：" + "；".join(unique_lines) + "。"
    return f"### 重复部分讲解\n\n{body}".strip()


def _canonicalize_slide_explanation(
    *,
    slide: Slide,
    markdown: str,
    extracted_text: str,
    extract_payload: dict | None,
    related_pages: list[int],
    question: str,
) -> tuple[str, dict]:
    cleaned = sanitize_slide_markdown(
        slide=slide,
        markdown=markdown,
        extracted_text=extracted_text,
        extract_payload=extract_payload,
    )
    title = _best_title(slide=slide, extracted_text=extracted_text, extract_payload=extract_payload)
    repeat_summary = _build_repeat_summary(extract_payload)
    sections = _split_sections(cleaned)
    translation_md = sections.get("### 完整翻译与解释")
    example_md = sections.get("### 例题完整讲解")
    concept_md = sections.get("### 知识点总结")
    summary_md = sections.get("### 知识点摘要")
    repeat_md = sections.get("### 重复部分讲解")

    is_example = _looks_like_example_page(
        extracted_text=extracted_text,
        question=question,
        extract_payload=extract_payload,
    )
    terms = _terms_sentence(extracted_text)
    summary = _summary_from_text(extracted_text, question)

    if not translation_md:
        translation_md = _build_translation_fallback(
            summary=summary,
            extracted_text=extracted_text,
            terms=terms,
        )

    if example_md:
        content_type = "example"
        primary_md = example_md
    elif concept_md:
        content_type = "concept"
        primary_md = concept_md
    else:
        content_type, primary_md = _build_primary_fallback(
            is_example=is_example,
            repeat_summary=repeat_summary,
            extracted_text=extracted_text,
            question=question,
        )

    if repeat_summary["has_repeat_section"] and not repeat_md:
        repeat_md = _build_repeat_fallback(extract_payload=extract_payload)

    canonical_parts = [
        f"## {title}",
        "",
        _build_intro_meta(related_pages=related_pages, repeat_summary=repeat_summary),
        "",
        translation_md.strip(),
        "",
        primary_md.strip(),
    ]
    if repeat_md:
        canonical_parts.extend(["", repeat_md.strip()])

    canonical_markdown = "\n".join(part for part in canonical_parts if part is not None).strip()
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
        "当前为离线回退讲解，只依据区域对应的稳定提取文本做保守说明。"
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
    if slide_image_path:
        # Try dual pipeline first (vision + text models)
        dual = DualModelPipeline()
        if dual.is_configured():
            try:
                answer = dual.generate(
                    slide_image_path=slide_image_path,
                    extraction_text=prompt_extraction_text,
                    page_num=slide.page_num,
                    question=question,
                    related_pages=related_pages,
                    repeat_analysis=(extract_payload or {}).get("repeat_analysis"),
                    document_id=slide.document_id,
                )
                canonical_markdown, meta = _canonicalize_slide_explanation(
                    slide=slide,
                    markdown=answer,
                    extracted_text=extracted_text,
                    extract_payload=extract_payload,
                    related_pages=related_pages,
                    question=question,
                )
                meta["pipeline"] = "dual"
                return canonical_markdown, follow_ups, degraded, meta
            except Exception:
                pass  # Fall through to single-model

        # Fallback: single vision model
        live_gateway = gateway or ModelGateway()
        if live_gateway.is_configured():
            try:
                answer = live_gateway.generate_slide_markdown(
                    prompt=prompt_contract,
                    slide_image_path=slide_image_path,
                    extraction_text=prompt_extraction_text,
                )
                canonical_markdown, meta = _canonicalize_slide_explanation(
                    slide=slide,
                    markdown=answer,
                    extracted_text=extracted_text,
                    extract_payload=extract_payload,
                    related_pages=related_pages,
                    question=question,
                )
                meta["pipeline"] = "single"
                return canonical_markdown, follow_ups, degraded, meta
            except Exception:
                degraded = True

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
        except Exception:
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
