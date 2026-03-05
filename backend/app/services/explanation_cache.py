from __future__ import annotations

from typing import Iterable


def _first_sentence(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        return "本页以图表或公式为主，建议结合问答进一步澄清关键概念。"
    return cleaned[:180]


def build_cached_slide_explanation(*, page_num: int, extracted_text: str) -> str:
    summary = _first_sentence(extracted_text)
    return (
        f"## Slide {page_num}\n\n"
        f"> [!NOTE]\n"
        f"> **本页核心**：<mark>{summary}</mark>\n\n"
        f"**知识点拆解**\n"
        f"1. **主命题**：先明确这页的主结论与适用边界。\n"
        f"2. *关键线索*：识别定义、假设、推导步骤的先后顺序。\n"
        f"3. **跨页关联**：把本页和前后页的上下文串起来。\n\n"
        f"> [!TIP]\n"
        f"> 用一句话复述“输入 -> 过程 -> 输出”，可以快速检查是否真正理解。\n\n"
        f"> [!WARNING]\n"
        f"> 常见误区：只记结论、不看前提；只看公式、不解释符号。\n"
    )


def build_document_explanations_markdown(*, title: str, slide_markdowns: Iterable[str]) -> str:
    lines = [f"# {title}", ""]
    for markdown in slide_markdowns:
        lines.append(markdown.strip())
        lines.append("")
    return "\n".join(lines).strip() + "\n"
