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


# ═══════════════════════════════════════════════════════════════
#  共用讲解原则（单模型 & 双模型 Stage 2 共用）
# ═══════════════════════════════════════════════════════════════

_OUTLINE_PROMPT_CORE = """\
你是一个中文大学课程助教。请把当前这页 PPT 讲解成"结构化讲解提纲"。

目标：
输出结果要像老师整理好的讲解提纲，而不是卡片式讲解，也不是纯复习笔记。
内容必须有解释性，但版式必须是提纲式、层次清楚、重点明确。

我想要的输出风格：
- 顶部是一个大标题：## 第 N 页：PPT原始标题 — 中文主题
- 后面主要使用 bullet list
- 每个 bullet 都是"粗体标签 + 解释内容"
- 看起来像高质量课堂讲解提纲
- 不是"这页讲什么 / 逐点讲解 / 本页关键结论"那种分块格式
- 不是大段散文式讲解

页面类型判断（只在心里判断，不要输出 page_type）：
- title：标题页 / 封面页
- toc：目录页 / 大纲页
- intro：导入页 / 问题引入页
- content：正式讲解页
- example：例题页
- summary：总结页

⚠️ 特殊页面处理（极其重要）：
- **title（封面页）**：只写课程名/章节名 + 讲师信息 + 本章主题一句话概括。不要解读封面上的装饰图片、背景图、配图。最多 2 个 bullet。
- **toc（目录页）**：只列出本章的章节结构，每个章节一个 bullet，简要说明涵盖什么内容。不要逐条深入解释。最多 3-4 个 bullet。
- 判断方法：如果页面主要内容是课程标题+教师姓名，那就是 title 页；如果页面是章节列表/大纲，那就是 toc 页。
- 封面上的图片（如点云、示意图、装饰图）只是装饰，不要对其进行学术分析。

讲解原则：
1. ⚠️ **严格按 PPT 原始顺序讲解**：按照 PPT 上 bullet points 的出现顺序逐条讲解，不要重新组织结构或打乱顺序。PPT 的教学顺序是经过设计的，不要"优化"它。
2. ⚠️ **只讲页面上有的内容**：不要添加 PPT 上没有的历史背景、编辑性评论、叙事框架（如"根本矛盾""原始驱动力"等）。如果 PPT 只是简单陈述一个事实，你也简单讲，不要包装成戏剧化的叙事。
3. ⚠️ **代码/数字/公式必须具体讲解**：如果 PPT 上有代码片段（如数组声明）、数字标注（如 64MB）、公式，必须具体解释它们的含义和计算过程，这是学生最需要帮助理解的部分。
4. 按知识点分组，不要按 bullet 机械拆分。相关的内容合在一起讲，细节用二级 bullet。一页通常 2-3 个要点就够。
5. 每个核心点写成：**标签：**1-2 句解释。标签自然即可，不要凑四字成语。
6. 解释要增加价值——不是用更花哨的中文复述原文，而是帮学生理解"为什么"和"怎么用"。可以补充具体例子、计算步骤、考试提示。
7. 不要写成长段落散文，不要写"这页讲什么 / 逐点讲解"等固定小节标题。
8. 不要显式写"上一页讲过""前面提到过"。
9. 每个 bullet 解释控制在 1-3 句话，总长度不超过原始 PPT 内容的 2 倍。

格式要求：

## 第 N 页：PPT原始标题 — {{中文主题}}

- **标签1：**解释内容
- **标签2：**解释内容
- **标签3：**解释内容
- **标签4：**解释内容

如有必要，可使用二级 bullet：
- **解决方案：**
  - **方法1：**解释内容
  - **方法2：**解释内容

禁止事项：
- 不要输出任何 callout（不要 > [!warning]、> [!tip]、> [!note]、> [!important]）
- 不要输出 blockquote（不要以 > 开头的行）
- 如果有易错点或提醒，直接写进对应 bullet 的解释内容里

标题规则：
- 格式：## 第 N 页：PPT原始标题 — 中文主题
- PPT原始标题：直接使用当前页 PPT 上的标题原文（英文就写英文）
- 中文主题：用中文概括本页核心，不超过 12 个字
- 如果原始标题本身已经足够清楚（如"FIFO Page Replacement"），中文主题可以写得更简练
- 如果原始标题过泛（如"Introduction"），中文主题要具体补充
- 示例：## 第 3 页：Memory Management — 内存管理基础

术语规则：
- 专业术语首次出现时写成：**中文 (English)**
- 同页后续可只写中文
- 术语保留在句子里，不要单独列术语表
- 公式用 KaTeX：$...$ 或 $$...$$
- ⚠️ 绝对不要把 $...$ 公式放在反引号里面，否则公式无法渲染

强调规则（加粗和高亮是两种不同工具，不要混用）：

加粗 **...** 的职责：术语锚点
- 解释内容里，专业术语首次出现时加粗：**中文 (English)**
- 每页 3-6 个不同术语，同一术语同页只加粗一次
- 不要用加粗来强调非术语内容（结论句不要加粗，用高亮）
- 不要整段加粗

高亮 ==...== 的职责：核心结论句
- 用于标注"如果只读高亮就能抓住本页精髓"的那种句子
- 必须是完整短句，不是单个词，不是术语
- 每页 1-2 处，content / intro / summary 页必须有至少 1 处
- title / toc 页可以没有
- 不要用高亮来标注术语（术语用加粗）

示例：
- 加粗：程序必须先加载到 **主存 (Main Memory)** 中才能执行
- 高亮：==程序不需要全部加载到内存中就可以运行==

长度要求：
- title：1-2 个 bullet（封面页不需要多说）
- toc：2-3 个 bullet（目录页只概括结构）
- intro / content / summary：4-6 个 bullet
- example：3-5 个一级 bullet，必要时配 2-4 个二级 bullet
- 每个 bullet 控制在 1-2 句
- 总体要紧凑，但必须能看懂"""


# ═══════════════════════════════════════════════════════════════
#  JSON 结构化输出 prompt（双模型 Stage 2 专用）
# ═══════════════════════════════════════════════════════════════

_JSON_SCHEMA_EXAMPLE = """\
{
  "page_num": 3,
  "original_title": "Memory Management",
  "chinese_topic": "内存管理基础",
  "content_type": "content",
  "items": [
    {
      "label": "",
      "explanation": "程序必须先加载到 **主存 (Main Memory)** 中才能执行。CPU 只能直接访问主存和缓存，不能直接执行磁盘上的代码。",
      "highlight": null,
      "sub_items": [
        {"label": "可执行代码", "explanation": "编译后的 **机器码 (Machine Code)**，或供解释器运行的源代码。"},
        {"label": "进程", "explanation": "**进程 (Process)** 就是正在执行的程序，包含代码、数据、栈、程序计数器等。"}
      ],
      "callout": null
    },
    {
      "label": "",
      "explanation": "关键问题：我们真的需要把整个程序都加载到内存中吗？例如在 64K 的 Apple II 上能否运行 100K 的程序？",
      "highlight": "程序不需要全部加载到内存中就可以运行",
      "sub_items": [],
      "callout": null
    },
    {
      "label": "",
      "explanation": "两种解决方案：",
      "highlight": null,
      "sub_items": [
        {"label": "Overlay", "explanation": "把程序分成阶段，当前阶段结束后再加载下一阶段，需要程序员手动管理。"},
        {"label": "Virtual Memory", "explanation": "OS 自动管理，只在需要执行时才加载所需部分，对程序员透明。"}
      ],
      "callout": {"type": "WARNING", "text": "Overlay 已被 Virtual Memory 取代。"}
    }
  ],
  "concepts": [
    {"name_en": "Main Memory", "name_zh": "主存", "description": "CPU 可直接访问的物理存储器"},
    {"name_en": "Virtual Memory", "name_zh": "虚拟内存", "description": "操作系统提供的逻辑地址空间，允许程序使用超过物理内存的地址范围"},
    {"name_en": "Overlay", "name_zh": "覆盖技术", "description": "早期手动管理内存的方式，将程序分段加载"}
  ]
}"""

_TEXT_EXPLANATION_JSON_PROMPT_BEFORE_SCHEMA = """\
你是大学课程助教，用简单易懂的中文讲解 PPT。说人话，别绕弯。

讲解原则：
1. 按 PPT 原始顺序讲，不要打乱。
2. ⚠️ 不要讲标题。标题只是分类标签。直接讲标题下面的内容。连续几页同标题不要重复提。
3. 代码/数字/公式要具体走一遍计算过程。公式用 KaTeX $...$，不要放在反引号内。LaTeX 命令的参数必须用花括号包裹，如 $\tilde{x}$ 不是 $\tilde x$。
4. 按知识点分组，不要按 bullet 机械拆分。相关的内容合成一个 item，细节用 sub_items。一页通常 2-3 个 item 就够。
5. label 留空（""）。sub_items 的 label 写短标签。
6. 术语首次写 **中文 (English)**，后面只写中文。
7. 前面页讲过的不要重复，一句话带过。
8. 不要写课程编号。
9. 封面页/目录页简短概括即可。

页面类型（写入 content_type）：title / toc / intro / content / example / summary

标题规则：
- original_title：PPT 上的原始标题
- chinese_topic：中文概括本页核心

标注规则：
- 粗体术语：**中文 (English)**
- highlight：本页最核心的一句结论（每页 0-1 个）
- callout：只在真正需要提醒的时候才加，大部分 item 不需要 callout（写 null）。一页最多 1 个 callout，很多页可以完全没有。type：IMPORTANT / TIP / WARNING / NOTE。

概念提取规则（concepts 字段）：
- 只提取本页出现的**真正的学科概念/专业术语**
- 每个概念需要 name_en（英文名）、name_zh（中文名）、description（一句话定义）
- 什么算概念：算法名、数据结构、理论模型、协议、定理、技术方案等
- 什么不算概念：变量名（如 tableA、n、i）、页面元素（如标题、图片）、课程编号、人名、泛化词（如 example、problem）
- 每页 2-5 个概念，没有就写空数组 []
- title / toc 页通常没有概念，写 []

请严格输出以下 JSON schema，不要输出任何其他内容（不要 ```json 包裹）：

"""

_TEXT_EXPLANATION_JSON_PROMPT_AFTER_SCHEMA = """

信息来源（冲突时以视觉模型为准）：
1. PyMuPDF 提取
2. 视觉模型提取（补充图表/公式/手写）
3. 前序页摘要（仅用于避免重复，不要引用）

当前页码：{page_num}
相关页码：{related}
用户问题：{question}

PyMuPDF 提取：
{extraction_text}

视觉模型提取：
{vision_extraction}

前序页摘要：
{previous_context}
"""


# ═══════════════════════════════════════════════════════════════
#  单模型 prompt（视觉模型看图 → 提纲式讲解）
# ═══════════════════════════════════════════════════════════════

_SLIDE_PROMPT_TEMPLATE = _OUTLINE_PROMPT_CORE + """

当前页码：{page_num}
相关页码：{related}
用户问题：{question}
提取文本：
{extracted_text}
"""


# ═══════════════════════════════════════════════════════════════
#  ROI（框选区域）prompt
# ═══════════════════════════════════════════════════════════════

_ROI_PROMPT_TEMPLATE = """\
学生框选了PPT上的一个区域，请重点讲解框选区域的内容。

规则：
- 重点讲解框选区域里的内容，这是学生最想理解的部分
- 可以引用同一页里的其他内容来辅助说明，但不要喧宾夺主
- 术语格式：**中文 (English)**，加粗
- 公式用 KaTeX，写完解释符号
- 重要结论用 <mark>荧光标注</mark>，最多 1 处
- 不要编造看不到的内容
- 不要讲解框选区域以外的无关内容
- 简洁直接，不要加考试技巧、记忆口诀
- 不要输出 callout / NOTE / TIP / WARNING

格式：

## 框选区域讲解

（直接讲解框选区域的内容）

页码：{page_num}
问题：{question}
区域坐标：x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f}
区域像素：{width} x {height}
提取文本：
{extracted_text}
"""


# ═══════════════════════════════════════════════════════════════
#  双模型 Stage 1：视觉提取（只提取不讲解）
# ═══════════════════════════════════════════════════════════════

_VISION_EXTRACTION_PROMPT = """\
从截图中提取所有内容，按阅读顺序输出。只提取，不讲解。

提取：
1. 标题
2. 所有文字（按阅读顺序）
3. 公式（LaTeX 格式）
4. 图表（类型、内容、关键数据和关系）
5. 代码
6. 表格（Markdown 格式）

优先级：公式 > 图表关系 > 表格 > 代码 > 重复正文。
看不清的标"不确定"。

PyMuPDF 对照：
{extraction_text}
"""


# ═══════════════════════════════════════════════════════════════
#  双模型 Stage 2：文本讲解（共用提纲式原则 + 信息来源）
# ═══════════════════════════════════════════════════════════════

_TEXT_EXPLANATION_PROMPT = _OUTLINE_PROMPT_CORE + """

信息来源（冲突时以视觉模型为准）：
1. PyMuPDF 提取
2. 视觉模型提取（补充图表/公式/手写）
3. 前序页摘要（仅用于判断哪些已讲过以避免重复，不要引用）

当前页码：{page_num}
相关页码：{related}
用户问题：{question}

PyMuPDF 提取：
{extraction_text}

视觉模型提取：
{vision_extraction}

前序页摘要：
{previous_context}
"""


# ═══════════════════════════════════════════════════════════════
#  Builder 函数
# ═══════════════════════════════════════════════════════════════

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
        previous_context=previous_context or "（文档起始，无前序页）",
    )


def build_text_explanation_json_prompt(
    *,
    page_num: int,
    question: str,
    extraction_text: str,
    vision_extraction: str,
    related_pages: Iterable[int],
    repeat_analysis: dict | None = None,
    previous_context: str = "",
) -> str:
    """Build the JSON-output variant of the Stage 2 prompt."""
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
    # Build prompt in parts: before-schema is plain text (no format vars),
    # schema example has raw JSON braces, after-schema has {variables}.
    after = _TEXT_EXPLANATION_JSON_PROMPT_AFTER_SCHEMA.format(
        page_num=page_num,
        related=related,
        question=question,
        extraction_text=(
            (extraction_text or "（无稳定提取文本）")
            + repeat_context
        ),
        vision_extraction=vision_extraction or "（视觉模型未返回结果）",
        previous_context=previous_context or "（文档起始，无前序页）",
    )
    return _TEXT_EXPLANATION_JSON_PROMPT_BEFORE_SCHEMA + _JSON_SCHEMA_EXAMPLE + after


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
            (extracted_text or "（无稳定提取文本，请依据截图讲解）")
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
        extracted_text=extracted_text or "（无提取文本，请依据截图讲解）",
    )
