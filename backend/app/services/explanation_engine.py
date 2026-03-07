from __future__ import annotations

from app.models import Slide
from app.services.prompt_templates import (
    build_roi_explanation_prompt,
    build_slide_explanation_prompt,
    format_bilingual_terms_markdown,
)


def _summary_from_text(extracted_text: str, question: str) -> str:
    cleaned = " ".join(extracted_text.split())
    if cleaned:
        return cleaned[:180]
    return f"页面文本有限，当前围绕“{question}”做保守讲解。"


def generate_slide_explanation(
    *,
    slide: Slide,
    question: str,
    extracted_text: str = "",
    related_pages: list[int] | None = None,
) -> tuple[str, list[str]]:
    related_pages = related_pages or [slide.page_num]
    citation = ", ".join(str(page_num) for page_num in sorted(set(related_pages)))
    prompt_contract = build_slide_explanation_prompt(
        page_num=slide.page_num,
        question=question,
        extracted_text=extracted_text,
        related_pages=related_pages,
    )
    terms_markdown = format_bilingual_terms_markdown(extracted_text)
    summary = _summary_from_text(extracted_text, question)
    answer = (
        f"## Slide {slide.page_num} 讲解\n\n"
        f"> [!NOTE]\n"
        f"> **问题聚焦**：围绕“*{question}*”建立本页理解框架。\n"
        f"> **引用页码**：{citation}\n"
        f"> **输出约束**：中文解释 + 英文术语标注，遵循结构化 Markdown。\n\n"
        "### 本页在讲什么 Summary\n"
        f"<mark>{summary}</mark>\n\n"
        "### 核心术语 Core Terms\n"
        f"{terms_markdown}\n\n"
        "### 知识链路 Reasoning Flow\n"
        "1. **主题定位**：先判断本页是在给出定义（Definition）、方法（Method）还是结论（Conclusion）。\n"
        "2. *推理展开*：把输入条件、关键步骤、输出结果按顺序复原。\n"
        "3. **跨页连接**：确认它和相关页码中的前置概念、延伸概念分别是什么。\n\n"
        "### 示例复盘 Example Walkthrough\n"
        "- 用“**已知条件 -> 推理步骤 -> 结论**”复述一次。\n"
        "- 如果这是方法页，优先说明它解决什么问题，以及何时不该使用。\n\n"
        "> [!TIP]\n"
        "> 复述时尽量把符号翻译成自然语言，会更容易发现理解漏洞。\n\n"
        "### 易错点 Pitfalls\n"
        "- 容易只记英文术语，不建立中文语义。\n"
        "- 容易只背结论，不检查它依赖的前提条件。\n"
        "- 容易把相关页当作重复内容，忽略它们提供的上下文。\n\n"
        "> [!WARNING]\n"
        "> 常见误区：只背结论、不查前提；只看公式、不解释符号。\n\n"
        "### 1分钟自测 Quick Check\n"
        "1. 本页核心结论是什么？\n"
        "2. 哪个前提变化会让结论失效？\n"
        "3. 你能用自己的话说出推理路径吗？\n"
        "\n"
        f"<!-- Prompt Contract\n{prompt_contract}\n-->\n"
    )

    follow_ups = [
        "请把这一页和前一页串起来讲一遍",
        "给我一个更直觉的例子",
        "出两道针对这页的判断题",
    ]
    return answer, follow_ups


def generate_roi_explanation(
    *,
    slide: Slide,
    question: str,
    extracted_text: str = "",
    roi_bbox: tuple[float, float, float, float],
    region_size: tuple[int, int],
) -> str:
    x, y, w, h = roi_bbox
    region_width, region_height = region_size
    prompt_contract = build_roi_explanation_prompt(
        page_num=slide.page_num,
        question=question,
        extracted_text=extracted_text,
        roi_bbox=roi_bbox,
        region_size=region_size,
    )
    terms_markdown = format_bilingual_terms_markdown(extracted_text)
    return (
        f"## 区域解释（Slide {slide.page_num}）\n\n"
        f"> [!NOTE]\n"
        f"> **区域坐标**：`x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f}`\n"
        f"> **区域像素**：`{region_width} x {region_height}`\n"
        f"> **解释策略**：局部先解释，再回到整页主线。\n\n"
        f"**问题**：*{question}*\n\n"
        "### 术语定位 Terms\n"
        f"{terms_markdown}\n\n"
        "### 建议阅读顺序 Reading Order\n"
        "1. 先识别 **标题/符号/对象**。\n"
        "2. 判断它是 *定义（Definition）*、*推导（Derivation）* 还是 *结论（Conclusion）*。\n"
        "3. 对照整页主线确认它的作用。\n\n"
        "> [!TIP]\n"
        "> 可把该区域一句话总结写进笔记，后续复习效率最高。\n"
        "\n"
        f"<!-- Prompt Contract\n{prompt_contract}\n-->\n"
    )
