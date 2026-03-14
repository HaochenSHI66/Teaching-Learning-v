from __future__ import annotations

import re

from app.models import SlideExplanation


def default_notebook_markdown(filename: str) -> str:
    return f"# {filename} 笔记本\n\n"


def _strip_markdown(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value.strip())
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_`>#-]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _sentence_candidates(*parts: str) -> list[str]:
    candidates: list[str] = []
    for part in parts:
        for chunk in re.split(r"[。！？\n]+", part):
            cleaned = _strip_markdown(chunk)
            if cleaned:
                candidates.append(cleaned)
    return candidates


def notebook_title_for_explanation(item: SlideExplanation) -> str:
    meta = getattr(item, "meta", None) or {}
    title = str(meta.get("title") or "").strip()
    if title:
        return title
    match = re.search(r"^##\s+(.+)$", item.markdown or "", flags=re.MULTILINE)
    if match:
        return match.group(1).strip()
    return f"第 {item.page_num} 页"


def build_autogen_notes_prompt(*, filename: str, explanations: list[SlideExplanation], title: str) -> str:
    lines = [
        "你是一个学习笔记整理助手。",
        "请基于已经存在的逐页讲解缓存，输出一份适合复习的 Markdown 笔记本。",
        "不要重新讲课，不要输出测验，不要输出 callout。",
        "必须使用中文，但核心术语可保留英文括注。",
        "必须对关键定义、核心结论、重要公式或关键术语使用 <mark>...</mark>。",
        "高亮要克制，每页 1 到 3 处，不要整段高亮。",
        "保持结构紧凑、可复习、可继续人工编辑。",
        "如果某页的讲解内容本身很简短（过渡页、标题页），对应笔记节也应简短，不要强行补充。",
        "",
        f"文档名：{filename}",
        f"笔记标题：{title}",
        "",
        "输出格式严格按照下方示例（将 N、标题 等占位符替换为实际内容，不要输出 <format_example> 标签本身）：",
        "<format_example>",
        f"# {filename} 笔记本",
        "",
        "## 第 N 页 · 标题",
        "",
        "### 核心内容",
        "一段中文总结。",
        "",
        "### 关键点",
        "- <mark>关键定义/结论</mark>",
        "- 重要条件或限制",
        "- 易混点",
        "",
        "### 公式与术语",
        "- <mark>术语 / 公式</mark>：一句解释",
        "</format_example>",
        "",
        "下面是现有逐页讲解缓存：",
        "",
    ]
    for item in explanations:
        lines.append(f"[第 {item.page_num} 页]")
        lines.append(item.markdown.strip())
        lines.append("")
    return "\n".join(lines).strip()


def build_notebook_fallback(
    *,
    filename: str,
    explanations: list[SlideExplanation],
) -> str:
    lines = [default_notebook_markdown(filename).rstrip(), ""]
    for item in explanations:
        meta = getattr(item, "meta", None) or {}
        sections = meta.get("sections") or {}
        title = notebook_title_for_explanation(item)
        translation = str(sections.get("translation_md") or item.markdown or "").strip()
        primary = str(sections.get("primary_md") or "").strip()

        summary_candidates = _sentence_candidates(translation, primary)
        summary = summary_candidates[0] if summary_candidates else "当前页的核心内容需要结合原始讲解进一步补充。"

        highlight_source = ""
        for candidate in summary_candidates[1:]:
            if len(candidate) >= 6:
                highlight_source = candidate
                break
        if not highlight_source:
            highlight_source = summary

        highlight_text = highlight_source[:80].rstrip("，。；;:：")

        term_line = ""
        term_candidates = re.findall(r"([A-Za-z][A-Za-z0-9 \-]{2,})", " ".join([translation, primary]))
        if term_candidates:
            term_line = f"- <mark>{term_candidates[0].strip()}</mark>：本页反复出现的核心术语。"

        lines.extend(
            [
                f"## 第 {item.page_num} 页 · {title}",
                "",
                "### 核心内容",
                summary,
                "",
                "### 关键点",
                f"- <mark>{highlight_text}</mark>",
                "- 结合原讲解补上自己的理解与限制条件。",
                "- 如果这一页和前文重复，优先记录新增变化。",
                "",
                "### 公式与术语",
                term_line or "- <mark>核心术语</mark>：结合原页标题与讲解进一步细化。",
                "",
            ]
        )
    return "\n".join(lines).strip() + "\n"
