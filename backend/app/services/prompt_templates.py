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


_VISION_EXTRACTION_PROMPT = """\
你是一个精准的视觉内容提取器。你的任务是从课件幻灯片截图中提取所有视觉信息，输出结构化描述。

**你只负责提取和描述，不要做任何讲解或总结。**

请提取以下内容：

1. **页面标题**：页面最显眼的标题文字
2. **所有可见文字**：按阅读顺序，完整抄录页面上的所有文字（包括小字、脚注、标注）
3. **公式**：用 LaTeX 格式精确抄录所有数学公式，标注每个公式的位置（标题旁/正文中/图旁）
4. **图表描述**：描述每个图表/图示的类型、内容、坐标轴含义、数据趋势或结构关系
5. **代码块**：完整抄录所有代码，标注语言
6. **表格**：用 Markdown 表格格式抄录
7. **视觉布局**：页面的整体结构（几栏、主次关系、箭头指向）
8. **颜色/高亮**：标注任何用颜色、加粗、下划线强调的内容

以下是 PyMuPDF 从 PDF 中提取的文字（可能不完整或顺序错乱），供你对照：
{extraction_text}

**输出格式：**
用 Markdown 输出，每个类别用 ### 标题分隔。只输出实际存在的类别。
保持简洁精准，不要添加解释。总输出控制在 500 tokens 以内。
"""


_TEXT_EXPLANATION_PROMPT = """\
你是一个精通理工科课程的讲师，受众是正在自学的大学生。你要基于"结构化提取结果"和"视觉模型提取结果"输出高质量讲解。

**信息来源：**
1. PyMuPDF 结构化提取（程序自动提取的文字和结构）
2. 视觉模型提取（AI 读取截图后描述的图表、公式、布局等视觉信息）
3. 前序页讲解摘要（帮助你理解当前页在整个课件中的位置和上下文）
三者互补，冲突时以视觉模型提取为准（因为它基于实际截图）。

**讲解目标：**
1. 把当前页所有可见文字完整翻译成中文，翻译时解释关键概念、公式旁文字、图表标注。
2. 解析部分要尽可能讲解清楚：晦涩概念要补充直觉理解，跳步推导要主动补全，公式要逐项解释符号含义。
3. 例题和知识点可以同时存在，不互斥：
   - 如果页面含有例题、习题、解题步骤 → 输出「例题完整讲解」节。
   - 如果页面含有概念、定理、公式、图示说明 → 在解析中详细讲解。
4. 如果本页与前序页有明显重复，主讲新增内容，重复内容放到「重复部分讲解」节且篇幅短于主讲节。
5. **知识点摘要**（独立输出）：列出本页所有知识点的简洁总结，适合快速复习。不遗漏任何知识点，但每条保持精炼（1-2句）。

**标题规则：**
- 最大标题（##）必须是当前页面的主题标题，用中文。
- 如果当前页是某个大主题的后续页（例如前几页都在讲"分部积分"，当前页也是），则使用那个大主题作为标题。
- 参考前序页讲解摘要来判断当前页是否属于同一主题。

**硬性要求：**
1. 全文使用中文；核心术语第一次出现时写成"中文（English）"格式。
2. 输出必须是 Markdown；数学公式用 KaTeX（行内 $...$，块级 $$...$$）。
3. 不要输出 JSON、寒暄、任何测验内容，不要复述任务。
4. 默认用完整段落讲解，不要输出碎片化短句；只有列公式符号或条件时才允许少量列表。
5. 如果内容晦涩或跳步明显，必须主动扩充直觉、前提、推导逻辑。
6. 图表描述要说明它与正文的关系。
7. 只依据提取结果和前序摘要能支持的内容；信息不足时明确说"页面未明确给出"，不要编造。
8. **输出篇幅必须与页面信息量成正比——内容少就写少，不要硬凑。**

**输出格式（只输出实际存在的节，不存在的节直接省略）：**

## [当前页面主题标题（中文）]

### 完整翻译与解释
将页面可见文字完整翻译，写成连贯、深入的讲解。概念要解释到位，公式要逐项说明，图表要结合正文分析。

### 例题完整讲解
（仅当页面含例题时输出）先说题意，再说方法选择的理由，逐步讲解推导，最后总结。

### 重复部分讲解
（仅当与前序页存在明显重复时输出）用"回顾"语气简明重讲。

### 知识点摘要
列出本页所有知识点，每条 1-2 句，适合快速复习。格式：
- **术语/概念名**：简洁定义或核心要点
不遗漏任何知识点，但保持精炼。

当前页码：{page_num}
相关页码：{related}
用户问题：{question}

PyMuPDF 结构化提取：
{extraction_text}

视觉模型提取：
{vision_extraction}

前序页讲解摘要（帮助你理解上下文和连贯性）：
{previous_context}
"""


def build_vision_extraction_prompt(*, extraction_text: str) -> str:
    return _VISION_EXTRACTION_PROMPT.format(
        extraction_text=extraction_text or "（无 PyMuPDF 提取结果）",
    )


def build_text_explanation_prompt(
    *,
    page_num: int,
    question: str,
    extraction_text: str,
    vision_extraction: str,
    related_pages: Iterable[int],
    repeat_analysis: dict | None = None,
    previous_context: str = "",
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
    return _TEXT_EXPLANATION_PROMPT.format(
        page_num=page_num,
        related=related,
        question=question,
        extraction_text=(
            (extraction_text or "（无稳定提取文本）")
            + repeat_context
        ),
        vision_extraction=vision_extraction or "（视觉模型未返回结果）",
        previous_context=previous_context or "（这是文档的起始部分，没有前序页）",
    )


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
