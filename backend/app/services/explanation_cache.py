from __future__ import annotations

from typing import Iterable

from app.services.prompt_templates import format_bilingual_terms_markdown


def _first_sentence(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        return "本页以图表或公式为主，建议结合问答进一步澄清关键概念。"
    return cleaned[:180]


def build_cached_slide_explanation(*, page_num: int, extracted_text: str) -> str:
    summary = _first_sentence(extracted_text)
    terms_markdown = format_bilingual_terms_markdown(extracted_text)
    return (
        f"## Slide {page_num}\n\n"
        f"**本页核心**：<mark>{summary}</mark>\n"
        f"**讲解语言**：中文解释为主，关键术语保留英文标注。\n\n"
        "### 本页在讲什么 Summary\n"
        "这页适合先抓主题，再定位术语，再回到例子或推导链路。\n\n"
        "### 核心术语 Core Terms\n"
        f"{terms_markdown}\n\n"
        "### 知识链路 Reasoning Flow\n"
        "1. **主题定位**：先确认这一页究竟在讲定义、方法还是结论。\n"
        "2. *关系梳理*：把条件、步骤、结果按顺序串起来。\n"
        "3. **跨页关联**：检查它依赖哪些前置页，后续又会在哪些页继续展开。\n\n"
        f"> [!TIP]\n"
        f"> 用一句话复述“输入 -> 过程 -> 输出”，可以快速检查是否真正理解。\n\n"
        "### 易错点 Pitfalls\n"
        "- 容易只背结论，不追踪术语之间的关系。\n"
        "- 容易看到英文名词却不建立中文语义。\n\n"
        f"> [!WARNING]\n"
        f"> 常见误区：只记结论、不看前提；只看公式、不解释符号。\n"
    )


def build_document_explanations_markdown(*, title: str, slide_markdowns: Iterable[str]) -> str:
    lines = [f"# {title}", ""]
    for markdown in slide_markdowns:
        lines.append(markdown.strip())
        lines.append("")
    return "\n".join(lines).strip() + "\n"
