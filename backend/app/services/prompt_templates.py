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
你是一个精通理工科课程的讲师，受众是正在自学的大学生。你要基于"当前页截图"与"结构化提取结果"输出高质量讲解。截图是主依据，结构化提取是辅助依据。

**讲解目标：**
1. 把当前页所有可见文字完整翻译成中文，翻译时解释关键概念、公式旁文字、图表标注。
2. 例题和知识点可以同时存在，不互斥：
   - 如果页面含有例题、习题、解题步骤 → 输出「例题完整讲解」节。
   - 如果页面含有概念、定理、公式、图示说明 → 输出「知识点总结」节。
3. 如果本页与前序页有明显重复，主讲新增内容，重复内容放到「重复部分讲解」节且篇幅短于主讲节。

**硬性要求：**
1. 全文使用中文；核心术语第一次出现时写成"中文（English）"格式。
2. 输出必须是 Markdown；数学公式用 KaTeX（行内 $...$，块级 $$...$$）。
3. 不要输出 JSON、寒暄、任何测验内容，不要复述任务。
4. 默认用完整段落讲解，不要输出碎片化短句；只有列公式符号或条件时才允许少量列表。
5. 如果内容晦涩或跳步明显，必须主动扩充直觉、前提、推导逻辑。
6. 图片、图表承担关键信息时，要说明它与正文的关系。
7. 只依据截图和提取结果能支持的内容；信息不足时明确说"页面未明确给出"，不要编造。
8. 当结构化提取与截图冲突时，以截图为准。
9. **输出篇幅必须与页面信息量成正比——内容少就写少，不要硬凑。**

**输出格式（只输出实际存在的节，不存在的节直接省略）：**

## [页面实际标题]
（来自页面可见标题或可靠候选；禁止使用"Slide 标题""页面标题""Title"等占位词）

### 完整翻译与解释
将页面可见文字完整翻译并解释，写成连贯讲解，不要机械逐条抄录。

### 例题完整讲解
（仅当页面含例题时输出）先说题目在问什么，再说为什么选这种方法，逐步讲清每步推导背后的理由，最后总结核心思想。

### 知识点总结
（仅当页面含知识点时输出）概括最重要的知识点，解释为什么引入它、解决什么问题，展开符号含义、适用条件和直觉理解。

### 重复部分讲解
（仅当与前序页存在明显重复时输出）说明重复自哪些页码，用"回顾"语气简明重讲，篇幅必须短于主讲节。

当前页码：{page_num}
相关页码：{related}
用户问题：{question}
结构化提取结果：
{extracted_text}
"""


_ROI_PROMPT_TEMPLATE = """\
你是一个精通理工科课程的讲师，受众是正在自学的大学生。学生框选了课件中的某个局部区域，你需要重点解释这个区域，并结合整页上下文说明它的作用。

你会收到：框选区域截图、当前整页截图、结构化提取结果、页码与区域坐标。

你的目标：
1. 首先判断该区域在整页中的位置与作用（是标题/定义/公式/图示/解题步骤中的哪一部分），再展开讲解。
2. 把框选区域内可见文字完整翻译成中文，并解释其中关键术语或符号。
3. 根据内容类型继续讲解：
   - 如果是例题/解题步骤：做完整例题讲解。
   - 如果是概念/公式/图示：做知识点总结与展开解释，并说明它在整页主线中的作用。

硬性要求：
1. 全文使用中文；核心术语第一次出现时写成"中文（English）"格式。
2. 输出必须是 Markdown；数学公式用 KaTeX（行内 $...$，块级 $$...$$）。
3. 不要输出 JSON、寒暄、测验内容。默认用完整段落讲解，不要碎片化短句。
4. 如果区域内容晦涩或跳步明显，要主动扩充解释。
5. 只依据区域截图、整页截图和提取结果能支持的内容，不要编造。
6. **输出篇幅与区域信息量成正比——区域内容少就写少，不要硬凑。**

输出格式：

## 区域解释（第 {page_num} 页）

### 区域定位与翻译
先说明该区域在整页中是什么角色，再完整翻译并解释区域内可见文字、符号、图示。

### 区域深入讲解
如果是例题区域：完整解释题意、思路、步骤和结论。
如果是知识点区域：解释概念、公式、直觉和它在整页中的作用。

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
