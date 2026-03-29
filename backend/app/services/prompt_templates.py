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
- title：标题页
- toc：目录页
- intro：导入页 / 问题引入页
- content：正式讲解页
- example：例题页
- summary：总结页

讲解原则：
1. 只根据当前页可见内容讲解，不脑补看不到的内容。
2. 必须按当前页真实内容提炼出 3-6 个核心点。
3. 每个核心点都要写成：
   - **标签：**1-2 句自然语言解释
4. 标签要自然，像老师板书时随手写的重点提示词。不要刻意凑四字成语或对仗短语。可以是术语本身（如"Swapping"、"Demand Paging"），也可以是简短描述（如"为什么需要虚拟内存"、"两种加载策略"）。长短不限，清楚就行。
5. 如果当前页有"问题 → 方法"结构，必须明确拆出来。
6. 如果当前页顶部有醒目的数字、数组、代码、图示、标签等，必须把它们融入讲解，不要忽略。
7. 解释必须讲清关系，不能只是把 PPT 原文换一种说法。
8. 不要写成"讲解卡片"，不要写成长段落。
9. 不要写"这页讲什么 / 逐点讲解 / 本页关键结论"这些固定小节标题。
10. 不要显式写"上一页讲过""前面提到过"。
11. 如果当前页有问题句（Does / Why / How / Do we really need...），必须明确把它点出来，因为这通常是本页灵魂。

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
- title / toc：2-4 个 bullet
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
      "label": "传统观念",
      "explanation": "程序必须先加载到 **主存 (Main Memory)** 中才能执行，而且通常是 **连续存储** 的。",
      "highlight": null,
      "sub_items": [],
      "callout": null
    },
    {
      "label": "核心问题",
      "explanation": "我们真的需要把整个程序都加载到内存中吗？例：在 64K 的 Apple II 上能否运行 100K 的程序？",
      "highlight": "程序不需要全部加载到内存中就可以运行",
      "sub_items": [],
      "callout": {"type": "IMPORTANT", "text": "这个问题是整章 Virtual Memory 的出发点。"}
    },
    {
      "label": "两种解决方案",
      "explanation": "针对上述问题，有两种方案：",
      "highlight": null,
      "sub_items": [
        {"label": "Overlay（覆盖）", "explanation": "把程序分成若干阶段，当前阶段结束后再加载下一阶段。需要程序员手动管理。"},
        {"label": "Virtual Memory（虚拟内存）", "explanation": "OS 自动管理，只在需要执行时才加载所需部分，对程序员透明。"}
      ],
      "callout": {"type": "WARNING", "text": "Overlay 需要程序员手动管理模块，已被 Virtual Memory 取代。"}
    }
  ]
}"""

_TEXT_EXPLANATION_JSON_PROMPT_BEFORE_SCHEMA = """\
你是一个中文大学课程助教。请把当前这页 PPT 讲解成结构化 JSON。

讲解原则（和 Markdown 模式一样，但输出格式不同）：
1. 只根据当前页可见内容讲解，不脑补。
2. 按当前页真实内容提炼出 3-6 个核心点。
3. 每个核心点拆成 label（短标签）+ explanation（2-4 句解释，要讲透，不要惜字）。
4. 标签要像老师整理重点时会写的短标题。
5. 如果当前页有"问题 → 方法"结构，必须拆出来。
6. 如果页面有代码，在 explanation 里用 Markdown 代码块（```language ... ```）给出关键代码，然后用自己的话逐行或逐段解释。
7. 如果页面顶部有醒目的数字/图示，必须融入讲解。
8. 用自己的话解释，不要直接复制粘贴 PPT 原文。讲清关系和原理，而不是换一种说法复述。
9. 不要在 explanation 里引用 PPT 原文（不要用代码块包裹 PPT 上的普通文字）。代码块只用于真正的代码。
10. 如果当前页有问题句（Does / Why / How / Do we really need...），必须点出来。
11. 术语首次出现写成：中文 (English)，同页后续只写中文。
12. 公式用 KaTeX 写在 explanation 里：行内用 $...$，独立公式用 $$...$$。
13. 不要显式写"上一页讲过""前面提到过"。

页面类型判断（写入 content_type 字段）：
title / toc / intro / content / example / summary

标题规则：
- original_title：当前页 PPT 上的原始标题（英文就写英文）
- chinese_topic：用中文概括本页核心，不超过 12 个字

标注规则（五层标注体系，层级分明）：
1. 粗体术语：在 explanation 里对术语用 **中文 (English)** 格式，每个 item 2-4 处
2. 高亮：每个 item 可以有 highlight 字段（字符串或 null），用于标注本页核心结论/关键发现，每页最多 1-2 个 item 有 highlight
3. callout：每个 item 可以有 callout 字段，type 只允许四种：
   - IMPORTANT：必记要点、核心定义、考试重点
   - TIP：辅助理解、帮助记忆、延伸说明
   - WARNING：易混淆、易错、常见误解
   - NOTE：补充说明，只针对当前这个点
4. callout 的 text 只写 1 句话
5. 每页最多 1-2 个 item 有 callout，其余为 null
6. 没有必要就不加 callout 和 highlight

长度规则：
- title / toc：2-4 个 items
- intro / content / summary：4-8 个 items
- example：4-6 个 items，必要时用 sub_items
- 每个 item 的 explanation 要充分展开，讲清楚"为什么"和"怎么理解"，不要只陈述事实

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
