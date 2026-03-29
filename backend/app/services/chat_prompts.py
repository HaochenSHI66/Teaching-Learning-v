"""Chat-specific prompt templates for the conversational tutor.

Separate from the explanation prompt templates in prompt_templates.py.
The explanation engine generates one-shot slide lectures; the chat engine
carries multi-turn conversations where brevity and context-awareness matter.
"""

from __future__ import annotations

import re

_PAGE_NUM_RE = re.compile(r"第\s*(\d+)\s*页|page\s*(\d+)", re.IGNORECASE)


def build_chat_system_prompt(
    *,
    slide_context: str = "",
    explanation_summary: str = "",
    question_type: str = "",
    extra_context: str = "",
) -> str:
    """Build the system prompt for conversational chat.

    Parameters
    ----------
    slide_context:
        Extracted text / structured data from the current slide.
    explanation_summary:
        First N chars of the cached SlideExplanation markdown (if available).
    question_type:
        Classification label from classify_question() — adjusts tone.
    extra_context:
        Additional context (e.g. cross-slide comparison data).
    """
    parts = [
        "你是一个耐心的大学助教，正在和学生一对一辅导。",
        "根据学生的具体问题简洁作答，不要每次都重复完整讲解。",
        "如果学生追问细节，直接回答那个细节；如果学生说「展开讲」，才给出更详细的解释。",
        "回答时使用中文，专业术语保留英文并附中文翻译，例如 Gradient Descent（梯度下降）。",
        "用 Markdown 格式组织回答，公式用 LaTeX（$...$）。",
    ]

    if slide_context:
        parts.append(f"\n---\n当前幻灯片提取内容：\n{slide_context[:1500]}")

    if explanation_summary:
        parts.append(f"\n---\n已生成的讲解摘要（可引用，不要完整复述）：\n{explanation_summary}")

    if extra_context:
        parts.append(f"\n---\n补充上下文：\n{extra_context}")

    if question_type:
        type_instructions = _QUESTION_TYPE_INSTRUCTIONS.get(question_type, "")
        if type_instructions:
            parts.append(f"\n---\n回答风格提示：{type_instructions}")

    return "\n".join(parts)


def build_global_system_prompt(
    *,
    document_title: str = "",
    slides_summary: str = "",
) -> str:
    """Build system prompt for global mode (no specific slide selected)."""
    parts = [
        "你是一个耐心的大学助教，正在和学生讨论一整套课件的内容。",
        "学生没有指定具体页码，请结合整套课件的上下文回答问题。",
        "如果问题太宽泛，可以反问学生想了解哪个具体话题。",
        "回答使用中文，专业术语保留英文并附中文翻译。",
    ]

    if document_title:
        parts.append(f"\n课件标题：{document_title}")

    if slides_summary:
        parts.append(f"\n---\n各页摘要：\n{slides_summary}")

    return "\n".join(parts)


def extract_page_numbers(text: str) -> list[int]:
    """Extract page numbers mentioned in user's question."""
    pages = []
    for match in _PAGE_NUM_RE.finditer(text):
        num = match.group(1) or match.group(2)
        if num:
            pages.append(int(num))
    return sorted(set(pages))


# ── Question type → style instruction mapping ──

_QUESTION_TYPE_INSTRUCTIONS = {
    "clarification": "学生在请求澄清某个概念，请简洁精准地回答，不要展开无关内容。",
    "deep_dive": "学生想深入了解，可以给出详细的解释、推导或举例。",
    "comparison": "学生在对比不同页面或概念，请分析它们的关联、区别和联系。",
    "verification": "学生在确认自己的理解是否正确，先判断对错，再简要说明原因。",
    "meta": "学生在问整体结构或总结，请给出高层概括。",
}
