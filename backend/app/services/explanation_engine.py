from __future__ import annotations

from app.models import Slide


def generate_slide_explanation(
    *,
    slide: Slide,
    question: str,
    related_pages: list[int] | None = None,
) -> tuple[str, list[str]]:
    related_pages = related_pages or [slide.page_num]
    citation = ", ".join(str(page_num) for page_num in sorted(set(related_pages)))
    answer = (
        f"## Slide {slide.page_num} 讲解\n\n"
        f"> [!NOTE]\n"
        f"> **问题聚焦**：围绕“*{question}*”建立本页理解框架。\n"
        f"> **引用页码**：{citation}\n\n"
        f"**本页主线**：<mark>先抓主结论，再核对前提与推导顺序</mark>。\n\n"
        "### 知识点拆解\n"
        "1. **主命题**：先识别标题与核心结论。\n"
        "2. *关键链路*：拆分输入、过程、输出关系。\n"
        "3. **跨页连接**：确认与前置知识的依赖关系。\n\n"
        "### 示例复盘\n"
        "- 用“**已知条件 -> 推理步骤 -> 结论**”复述一次。\n\n"
        "> [!TIP]\n"
        "> 复述时尽量把符号翻译成自然语言，会更容易发现理解漏洞。\n\n"
        "> [!WARNING]\n"
        "> 常见误区：只背结论、不查前提；只看公式、不解释符号。\n\n"
        "### 1分钟自测\n"
        "1. 本页核心结论是什么？\n"
        "2. 哪个前提变化会让结论失效？\n"
        "3. 你能用自己的话说出推理路径吗？\n"
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
    roi_bbox: tuple[float, float, float, float],
    region_size: tuple[int, int],
) -> str:
    x, y, w, h = roi_bbox
    region_width, region_height = region_size
    return (
        f"## 区域解释（Slide {slide.page_num}）\n\n"
        f"> [!NOTE]\n"
        f"> **区域坐标**：`x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f}`\n"
        f"> **区域像素**：`{region_width} x {region_height}`\n\n"
        f"**问题**：*{question}*\n\n"
        "### 建议阅读顺序\n"
        "1. 先识别 **标题/符号/对象**。\n"
        "2. 判断它是 *定义*、*推导* 还是 *结论*。\n"
        "3. 对照整页主线确认它的作用。\n\n"
        "> [!TIP]\n"
        "> 可把该区域一句话总结写进笔记，后续复习效率最高。\n"
    )
