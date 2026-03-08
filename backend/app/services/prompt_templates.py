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
你是一个专业的学科讲师，负责帮助学生深入理解课件内容。
请仔细分析本页内容，然后按以下要求输出完整讲解。

【第一步：判断内容类型】
先判断本页属于哪种类型：
- 「例题型」：页面包含具体例题、示例计算、worked example、example、solution 等
- 「知识点型」：页面是概念定义、定理、方法介绍、理论推导、公式说明等

【输出格式与内容要求】
1. 全文使用中文，核心术语采用"中文（English）"格式标注。
2. 输出为 Markdown 格式，不要输出 JSON，不要输出多余寒暄。
3. 讲解内容必须写成完整的段落和连贯的叙述，严禁只输出一行一行的短句或碎片化列表。
   遇到晦涩、抽象或复杂的知识点，必须充分展开解释，不能只给一句话带过。
4. 所有数学公式必须使用 KaTeX 语法：行内公式用 $公式$，块级公式用 $$公式$$（独占一行）。
   禁止使用 \[...\]、\(...\)、[ ... ] 等其他任何格式，只能用 $ 和 $$ 作为定界符。
5. 禁止输出「1分钟自测」、「Quick Check」等任何形式的测验内容。
6. 必须包含以下两个部分，按顺序输出：

   ---
   ## 完整翻译
   将本页所有文字内容完整、准确地翻译成中文，包括标题、正文、公式旁的文字说明、
   图表标注、角注等，不得遗漏任何内容。翻译要忠实原文，不要意译或省略。

   ---
   ## 知识点讲解
   根据内容类型选择讲解方式：

   若为「例题型」：
   对例题进行完整、系统的讲解。先用自己的话说清楚题目在问什么，
   然后说明解题思路和方法选择的原因，再逐步推导每一个步骤，
   解释每步背后的道理而不是只列算式，最后总结例题想说明的核心结论。
   要像老师在课堂上讲题一样讲透，让学生真正理解，而不是只给出答案。

   若为「知识点型」：
   对本页的知识点进行深入、完整的讲解。要解释每个重要概念是什么、
   为什么引入它、直觉上应该怎么理解。如果有公式，必须逐一解释公式中
   每个符号的含义以及公式背后的逻辑与推导思路。如果某个概念比较抽象，
   要用类比或具体情境帮助理解。要说清楚本页知识和前后知识点的联系。
   不能只做字面翻译，必须真正把知识讲清楚、讲透彻。

6. 如果原页内容不完整，要明确说明信息不足，不要编造公式或定义。

当前页码：{page_num}
相关页码：{related}
用户问题：{question}
页面提取文本：
{extracted_text}
"""

_ROI_PROMPT_TEMPLATE = """\
你是一个专业的学科讲师，学生框选了课件中的某个局部区域请你重点讲解。
请聚焦于框选区域的内容，同时结合整页背景进行讲解。

【第一步：判断框选区域的内容类型】
- 「例题型」：框选区域包含例题、计算步骤、worked example、solution 等
- 「知识点型」：框选区域是概念、公式、定理、推导过程等

【输出格式与内容要求】
1. 全文使用中文，核心术语采用"中文（English）"格式标注。
2. 输出为 Markdown 格式。
3. 讲解必须写成完整的段落和连贯的叙述，严禁只输出一行一行的短句或碎片化列表。
   对于晦涩或复杂的内容，必须充分展开解释，不能一笔带过。
4. 所有数学公式必须使用 KaTeX 语法：行内公式用 $公式$，块级公式用 $$公式$$（独占一行）。
   禁止使用 \[...\]、\(...\) 等其他任何格式，只能用 $ 和 $$ 作为定界符。
5. 禁止输出「1分钟自测」、「Quick Check」等任何测验内容。
6. 必须包含以下两个部分，按顺序输出：

   ---
   ## 区域内容翻译
   将框选区域内的所有文字完整、准确地翻译成中文，不得遗漏。

   ---
   ## 知识点讲解
   若为「例题型」：完整讲解例题，先理解题意，再说明解题思路，
   逐步解释每个推导步骤背后的道理，最后总结核心结论。要讲透，不能只列步骤。

   若为「知识点型」：深入解释框选区域内每个概念、公式符号的含义，
   说明其直觉理解和在整页内容中的作用。如果内容抽象，要用类比帮助理解。
   要说清楚这部分知识和整页其他内容的联系。

页码：{page_num}
问题：{question}
区域坐标：x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f}
区域像素：{width} x {height}
整页提取文本：
{extracted_text}
"""


def build_slide_explanation_prompt(
    *,
    page_num: int,
    question: str,
    extracted_text: str,
    related_pages: Iterable[int],
) -> str:
    related = ", ".join(str(page) for page in sorted(set(related_pages)))
    return _SLIDE_PROMPT_TEMPLATE.format(
        page_num=page_num,
        related=related,
        question=question,
        extracted_text=extracted_text or "（无可提取文本，请基于页面图像内容进行讲解）",
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
        extracted_text=extracted_text or "（无可提取文本，请根据图像内容讲解）",
    )
