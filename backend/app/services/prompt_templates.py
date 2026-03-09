from __future__ import annotations

from collections.abc import Iterable


TERM_GLOSSARY: list[tuple[str, str]] = [
    ("gradient descent", "梯度下降"),
    ("matrix decomposition", "矩阵分解"),
    ("chain rule", "链式法则"),
    ("step size", "步长"),
    ("linear algebra", "线性代数"),
    ("eigenvectors", "特征向量"),
    ("eigenspace", "特征子空间"),
    ("derivative", "导数"),
    ("gradient", "梯度"),
    ("optimization", "优化"),
    ("convergence", "收敛"),
    ("matrix", "矩阵"),
    ("rank", "秩"),
    ("queue", "队列"),
    ("cache", "缓存"),
    ("worker", "工作进程"),
    ("scheduler", "调度器"),
    ("mutex", "互斥锁"),
    ("deadlock", "死锁"),
    ("calculus", "微积分"),
]


def extract_bilingual_terms(extracted_text: str, *, max_terms: int = 5) -> list[tuple[str, str]]:
    lowered = extracted_text.lower()
    matched: list[tuple[str, str]] = []
    for english, chinese in TERM_GLOSSARY:
        if english in lowered and (chinese, english.title()) not in matched:
            matched.append((chinese, english.title()))
        if len(matched) >= max_terms:
            break

    if matched:
        return matched

    return [("核心概念", "Key Concept")]


def format_bilingual_terms_markdown(extracted_text: str) -> str:
    terms = extract_bilingual_terms(extracted_text)
    return "\n".join(
        f"- **{chinese}（{english}）**：说明这个术语在本页承担的角色与边界。"
        for chinese, english in terms
    )


_SLIDE_PROMPT_TEMPLATE = """\
你是一个专业、克制、讲解能力很强的学科讲师。你要基于“当前页截图”与“结构化提取结果”输出高质量讲解。截图是主依据，结构化提取是辅助依据。

你的首要目标：
1. 先把当前页所有可见文字内容完整翻译成中文，并在翻译时顺带解释关键概念。
2. 然后根据页面类型继续讲解：
   - 如果是例题页，就做完整例题讲解。
   - 如果是知识点页，就做知识点总结与展开解释。
3. 如果检测到本页与前面页面有明显重复，请主讲本页相对前文“新增或深化”的内容，并把重复内容放到单独的“重复部分讲解”里。

在回答前，请先在心里判断页面属于哪种类型：
- 「例题型」：有明确题目、已知条件、求解目标、推导步骤、worked example、solution、exercise 等
- 「知识点型」：概念定义、定理、方法介绍、公式说明、理论推导、图示说明、总结页等

硬性要求：
1. 全文使用中文。
2. 核心术语第一次出现时，必须写成“中文（English）”格式。
3. 输出必须是 Markdown。
4. 不要输出 JSON，不要寒暄，不要复述你的任务。
5. 不要输出「1分钟自测」「Quick Check」或任何测验内容。
6. 不要把讲解写成一行一行的碎片化短句；默认用完整段落去讲，只有在列公式符号或条件时才允许少量列表。
7. 如果知识点晦涩、抽象或跳步明显，必须主动扩充解释，把直觉、前提、符号含义和推导逻辑讲清楚。
8. 数学公式必须使用 KaTeX 语法：行内公式用 $...$，块级公式用 $$...$$。
9. 如果图片、图表、流程图、示意图承担了关键信息，要把它们和正文的关系讲出来。
10. 只能依据截图和提取结果中能支持的内容来讲；如果页面信息不足，就明确说“页面未明确给出”或“根据当前页只能保守判断到这里”，不要编造。
11. 如果重复分析显示本页和前序页有大量重复，主讲部分必须优先讲新增内容；重复内容只能放在“重复部分讲解”中，且篇幅短于主讲部分。

输出格式必须严格如下：

## [页面实际标题]
- 必须来自页面可见标题或可靠标题候选
- 禁止使用“Slide 标题”“页面标题”“Title”等占位词

### 完整翻译与解释
要求：
- 将当前页可见文字完整翻译成中文
- 翻译时不要只做直译，要把关键术语、公式旁文字、图表标注一起解释清楚
- 如果页面中有图示但图中文字不完整，可以明确说明哪些部分可见、哪些部分无法确认
- 这部分要写成连贯讲解，不要写成机械逐条抄录

### 例题完整讲解
仅当页面属于「例题型」时输出这一节；如果不是例题页，就不要输出这一节。
要求：
- 先用自己的话说清楚题目在问什么
- 再说明为什么选这种方法
- 逐步讲清每一步推导、计算或判断背后的理由
- 不要只罗列步骤，要讲“为什么这样做”
- 最后总结这道题想说明的核心思想

### 知识点总结
仅当页面属于「知识点型」时输出这一节；如果不是知识点页，就不要输出这一节。
要求：
- 概括本页最重要的知识点是什么
- 解释为什么要引入它、它解决什么问题
- 如果有公式，要解释符号含义、适用条件和直觉理解
- 如果内容抽象，要主动给出类比、直觉或具体情境
- 如果本页和前后页有关系，要把这层关系讲出来

补充要求：
- 当页面很稀疏、像过渡页或标题页时，不要硬凑大段结论；应说明它在课程结构中的作用。
- 当结构化提取与截图存在冲突时，以截图为准，并在表述上保持保守。

### 重复部分讲解
仅当重复分析明确显示本页和前序页存在明显重复时输出这一节；如果没有明显重复，就不要输出这一节。
要求：
- 说明这部分主要重复自哪些页码
- 用“回顾/复讲”的语气简明重讲核心内容
- 不要把整个主讲部分复制过来
- 这一节必须短于“例题完整讲解”或“知识点总结”

当前页码：{page_num}
相关页码：{related}
用户问题：{question}
结构化提取结果：
{extracted_text}
"""


_ROI_PROMPT_TEMPLATE = """\
你是一个专业、克制、讲解能力很强的学科讲师。学生框选了课件中的某个局部区域，你需要重点解释这个区域，并结合整页上下文说明它的作用。

你会收到：
1. 框选区域截图
2. 当前整页截图
3. 当前页结构化提取结果
4. 页码、问题、区域坐标

你的目标：
1. 先把框选区域内可见文字完整翻译成中文，并解释其中关键术语或符号。
2. 再根据内容类型继续讲解：
   - 如果框选区域是例题/解题步骤，就做完整例题讲解。
   - 如果框选区域是概念/公式/图示，就做知识点总结与展开解释。

硬性要求：
1. 全文使用中文。
2. 核心术语第一次出现时，必须写成“中文（English）”格式。
3. 输出必须是 Markdown。
4. 不要输出 JSON，不要寒暄，不要输出测验内容。
5. 默认用完整段落讲解，不要输出碎片化短句。
6. 如果区域内容晦涩或跳步明显，要主动扩充解释。
7. 只能依据区域截图、整页截图和提取结果能支持的内容来讲，不要编造。
8. 数学公式必须使用 KaTeX 语法：行内公式用 $...$，块级公式用 $$...$$。

输出格式必须严格如下：

## 区域解释（第 {page_num} 页）

### 区域内容翻译与解释
- 先完整翻译区域内可见文字
- 再解释区域里的关键词、符号、箭头、图示或局部结构

### 区域深入讲解
- 如果是例题区域：完整解释题意、思路、步骤和结论
- 如果是知识点区域：解释概念、公式、直觉和它在整页中的作用
- 要明确说明这个区域和整页主线之间的关系

页码：{page_num}
用户问题：{question}
区域坐标：x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f}
区域像素：{width} x {height}
结构化提取结果：
{extracted_text}
"""


def build_slide_explanation_prompt(
    *,
    page_num: int,
    question: str,
    extracted_text: str,
    related_pages: Iterable[int],
    repeat_analysis: dict | None = None,
) -> str:
    related = ", ".join(str(page) for page in sorted(set(related_pages)))
    repeat_analysis = repeat_analysis or {}
    window_pages = ", ".join(str(page) for page in repeat_analysis.get("window_pages") or [])
    repeat_pages = ", ".join(str(page) for page in repeat_analysis.get("repeat_pages") or [])
    repeated_ratio = float(repeat_analysis.get("repeated_ratio") or 0.0)
    repeated_blocks = repeat_analysis.get("repeated_blocks") or []
    new_block_ids = repeat_analysis.get("new_block_ids") or []
    repeated_excerpt_lines = []
    for item in repeated_blocks[:5]:
        repeated_excerpt_lines.append(
            f"- 当前块 {item.get('current_block_id')} 与第 {item.get('source_page_num')} 页重复：{item.get('current_excerpt')}"
        )
    repeat_context = (
        f"\n重复分析：\n"
        f"- 最近比较页：{window_pages or '无'}\n"
        f"- 检测到重复页：{repeat_pages or '无'}\n"
        f"- 重复占比：{repeated_ratio:.2f}\n"
        f"- 新增块数量：{len(new_block_ids)}\n"
        f"- 重复块摘要：\n" + ("\n".join(repeated_excerpt_lines) if repeated_excerpt_lines else "- 无明显重复块")
    )
    return _SLIDE_PROMPT_TEMPLATE.format(
        page_num=page_num,
        related=related,
        question=question,
        extracted_text=(
            (extracted_text or "（无稳定提取文本，请优先依据页面截图讲解，并在不确定时明确说明信息不足）")
            + repeat_context
        ),
    )


def build_roi_explanation_prompt(
    *,
    page_num: int,
    question: str,
    extracted_text: str,
    roi_bbox: tuple[float, float, float, float],
    region_size: tuple[int, int],
) -> str:
    x, y, w, h = roi_bbox
    width, height = region_size
    return _ROI_PROMPT_TEMPLATE.format(
        page_num=page_num,
        question=question,
        x=x,
        y=y,
        w=w,
        h=h,
        width=width,
        height=height,
        extracted_text=extracted_text or "（无稳定提取文本，请优先依据区域截图与整页截图讲解，并在不确定时明确说明信息不足）",
    )
