from __future__ import annotations

from pathlib import Path

from app.models import Slide
from app.services.model_gateway import ModelGateway
from app.services.prompt_templates import (
    build_roi_explanation_prompt,
    build_slide_explanation_prompt,
)


def _summary_from_text(extracted_text: str, question: str) -> str:
    cleaned = " ".join(extracted_text.split())
    if cleaned:
        return cleaned[:180]
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

    if extracted_text.strip():
        lines.append("Raw Extracted Text:")
        lines.append(extracted_text.strip())

    return "\n".join(lines).strip() or "（无稳定结构化提取结果）"


def _template_slide_explanation(
    *,
    slide: Slide,
    question: str,
    extracted_text: str,
    related_pages: list[int],
) -> str:
    citation = “, “.join(str(page_num) for page_num in sorted(set(related_pages)))
    summary = _summary_from_text(extracted_text, question)
    return (
        f”## 第 {slide.page_num} 页讲解\n\n”
        f”> [!NOTE]\n”
        f”> 本页为第 {citation} 页相关内容的讲解，围绕”*{question}*”展开。\n\n”
        “---\n\n”
        “## 完整翻译\n\n”
        f”{summary}\n\n”
        “（注：AI 讲解暂时不可用，以下为基础框架，请稍后重试获取完整讲解。）\n\n”
        “---\n\n”
        “## 知识点讲解\n\n”
        “当前页面内容提取有限，无法生成完整的深度讲解。请确认 AI 服务正常后重新生成，”
        “或直接在对话框中提问具体问题。\n”
        “\n”
    )


def _template_roi_explanation(
    *,
    slide: Slide,
    question: str,
    extracted_text: str,
    roi_bbox: tuple[float, float, float, float],
    region_size: tuple[int, int],
) -> str:
    x, y, w, h = roi_bbox
    region_width, region_height = region_size
    return (
        f"## 区域讲解（第 {slide.page_num} 页）\n\n"
        f"> [!NOTE]\n"
        f"> 框选区域坐标：`x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f}`，"
        f"像素大小：`{region_width} x {region_height}`\n\n"
        f"**问题**：*{question}*\n\n"
        "---\n\n"
        "## 区域内容翻译\n\n"
        "（注：AI 讲解暂时不可用，无法提取框选区域的完整内容，请稍后重试。）\n\n"
        "---\n\n"
        "## 知识点讲解\n\n"
        "当前无法生成框选区域的深度讲解。请确认 AI 服务正常后重新框选，"
        "或在对话框中直接描述你想理解的内容。\n"
        "\n"
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
) -> tuple[str, list[str], bool]:
    related_pages = related_pages or [slide.page_num]
    follow_ups = [
        "请把这一页和前一页串起来讲一遍",
        "给我一个更直觉的例子",
        "出两道针对这页的判断题",
    ]
    prompt_extraction_text = _extraction_text_for_prompt(extracted_text, extract_payload)
    prompt_contract = build_slide_explanation_prompt(
        page_num=slide.page_num,
        question=question,
        extracted_text=prompt_extraction_text,
        related_pages=related_pages,
    )

    degraded = False
    if slide_image_path:
        live_gateway = gateway or ModelGateway()
        try:
            answer = live_gateway.generate_slide_markdown(
                prompt=prompt_contract,
                slide_image_path=slide_image_path,
                extraction_text=prompt_extraction_text,
            )
            return answer, follow_ups, degraded
        except Exception:
            degraded = True

    answer = _template_slide_explanation(
        slide=slide,
        question=question,
        extracted_text=extracted_text,
        related_pages=related_pages,
    )
    return answer, follow_ups, degraded


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
            return answer, degraded
        except Exception:
            degraded = True

    answer = _template_roi_explanation(
        slide=slide,
        question=question,
        extracted_text=extracted_text,
        roi_bbox=roi_bbox,
        region_size=region_size,
    )
    return answer, degraded
