"""Deterministic JSON-to-Markdown renderer for PPT slide explanations.

Uses HTML tags (<strong>, <mark>) instead of Markdown syntax to avoid
rendering issues when the frontend handles list items without inline
Markdown parsing.

Five-layer annotation system:
1. <strong>术语</strong> — key terms inline in explanation
2. <mark>高亮</mark> — core conclusion / key finding (highlight field)
3. [!important] — must-remember points
4. [!tip] — aids understanding
5. [!warning] — common mistakes / confusion
"""

from __future__ import annotations

import re

MAX_CALLOUTS_PER_PAGE = 2

_CALLOUT_EMOJI = {
    "IMPORTANT": "❗",
    "TIP": "💡",
    "WARNING": "⚠️",
    "NOTE": "📌",
}
_CALLOUT_LABEL = {
    "IMPORTANT": "重点",
    "TIP": "提示",
    "WARNING": "注意",
    "NOTE": "说明",
}

# Convert **bold** to <strong>bold</strong> in explanation text
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")


def _safe_str(val: object, default: str = "") -> str:
    return str(val) if val is not None else default


def _inline_bold_to_html(text: str) -> str:
    """Convert **bold** markdown to <strong> HTML tags."""
    return _BOLD_RE.sub(r"<strong>\1</strong>", text)


def _render_callout(callout: dict | None) -> str | None:
    """Render a callout as a blockquote with emoji + bold label."""
    if not callout or not isinstance(callout, dict):
        return None
    raw_type = _safe_str(callout.get("type"), "NOTE").upper()
    ctype = raw_type if raw_type in _CALLOUT_EMOJI else "NOTE"
    text = _safe_str(callout.get("text"))
    if not text:
        return None
    emoji = _CALLOUT_EMOJI[ctype]
    label = _CALLOUT_LABEL[ctype]
    return f"> {emoji} **{label}：** {text}"


def _render_item(item: dict) -> tuple[str, str | None, str | None]:
    """Render one item → (body_lines, highlight_line, callout_block)."""
    label = _safe_str(item.get("label"))
    explanation = _inline_bold_to_html(_safe_str(item.get("explanation")))
    highlight = _safe_str(item.get("highlight")) if item.get("highlight") else None
    sub_items: list[dict] = item.get("sub_items") or []
    callout = item.get("callout")

    lines: list[str] = []
    if label:
        lines.append(f"- <strong>{label}：</strong>{explanation}")
    elif explanation:
        lines.append(f"- {explanation}")

    for sub in sub_items:
        if not isinstance(sub, dict):
            continue
        sub_label = _safe_str(sub.get("label"))
        sub_explanation = _inline_bold_to_html(_safe_str(sub.get("explanation")))
        if sub_label:
            lines.append(f"  - <strong>{sub_label}：</strong>{sub_explanation}")
        elif sub_explanation:
            lines.append(f"  - {sub_explanation}")

    body = "\n".join(lines)

    highlight_line = None
    if highlight:
        highlight_line = f"  - <mark>{highlight}</mark>"

    callout_block = _render_callout(callout)
    return body, highlight_line, callout_block


def _build_title(data: dict) -> str:
    page_num = data.get("page_num", "?")
    original_title = _safe_str(data.get("original_title")).strip()
    chinese_topic = _safe_str(data.get("chinese_topic")).strip()

    if original_title and chinese_topic:
        return f"## 第 {page_num} 页：{original_title} — {chinese_topic}"
    elif original_title:
        return f"## 第 {page_num} 页：{original_title}"
    elif chinese_topic:
        return f"## 第 {page_num} 页：{chinese_topic}"
    else:
        return f"## 第 {page_num} 页"


def render_explanation_json(data: dict) -> str:
    """Render structured JSON into Markdown with HTML inline tags."""
    if not data or not isinstance(data, dict):
        return ""

    title = _build_title(data)
    items: list[dict] = data.get("items") or []

    parts: list[str] = [title]
    callout_count = 0

    for item in items:
        if not isinstance(item, dict):
            continue

        body, highlight_line, callout_block = _render_item(item)
        if not body:
            continue

        parts.append("")
        parts.append(body)

        if highlight_line:
            parts.append(highlight_line)

        if callout_block and callout_count < MAX_CALLOUTS_PER_PAGE:
            parts.append("")
            parts.append(callout_block)
            callout_count += 1

    return "\n".join(parts) + "\n"


def build_meta_from_json(data: dict) -> dict:
    """Extract a meta dict compatible with the existing explanation meta format."""
    if not data or not isinstance(data, dict):
        data = {}

    title = _build_title(data)
    full_md = render_explanation_json(data)

    body_lines = full_md.split("\n", 1)
    body_md = body_lines[1].lstrip("\n") if len(body_lines) > 1 else ""

    return {
        "render_mode": "outline-json",
        "content_type": data.get("content_type", "concept"),
        "title": title,
        "repeat_summary": {},
        "sections": {
            "translation_md": body_md,
            "primary_md": "",
            "repeat_md": "",
            "summary_md": "",
        },
        "concepts": [],
        "structured_items": data.get("items") or [],
    }
