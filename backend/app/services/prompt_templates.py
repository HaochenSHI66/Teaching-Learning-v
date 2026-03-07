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


def build_slide_explanation_prompt(
    *,
    page_num: int,
    question: str,
    extracted_text: str,
    related_pages: Iterable[int],
) -> str:
    related = ", ".join(str(page) for page in sorted(set(related_pages)))
    return (
        "你是一个负责逐页讲解课件的中文学习助手。\n"
        "你的目标不是翻译原文，而是帮助学生真正学懂这一页。\n\n"
        "输出要求：\n"
        "1. 全文使用中文讲解，但核心知识点术语必须采用“中文（English）”格式。\n"
        "2. 输出必须是结构化 Markdown，不要输出 JSON，不要输出多余寒暄。\n"
        "3. 必须包含以下部分：\n"
        "   - ## Slide 标题\n"
        "   - NOTE callout，总结本页主题与引用页码\n"
        "   - ### 本页在讲什么 Summary\n"
        "   - ### 核心术语 Core Terms\n"
        "   - ### 知识链路 Reasoning Flow\n"
        "   - ### 易错点 Pitfalls\n"
        "   - ### 1分钟自测 Quick Check\n"
        "4. 如果原页内容不完整，要明确写出信息不足，不要编造公式或定义。\n"
        "5. Markdown 中可以使用加粗、斜体、列表、callout、highlight。\n\n"
        f"当前页码：{page_num}\n"
        f"相关页码：{related}\n"
        f"用户问题：{question}\n"
        "页面提取文本：\n"
        f"{extracted_text or '（无可提取文本，请基于页面结构给出保守讲解）'}\n"
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
    return (
        "你是一个负责解释课件局部区域的中文学习助手。\n"
        "请只围绕框选区域回答，但要说明它与整页主线的关系。\n\n"
        "输出要求：\n"
        "1. 使用中文解释，关键术语写成“中文（English）”。\n"
        "2. 输出为 Markdown。\n"
        "3. 必须包含：区域说明、术语定位、作用判断、阅读建议。\n\n"
        f"页码：{page_num}\n"
        f"问题：{question}\n"
        f"区域坐标：x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f}\n"
        f"区域像素：{width} x {height}\n"
        "整页提取文本：\n"
        f"{extracted_text or '（无可提取文本）'}\n"
    )
