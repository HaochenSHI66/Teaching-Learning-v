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
    """Build prompt for generating compact review notes from per-slide explanations.

    This is the "second layer" — it takes the per-slide explanations (first layer)
    and distills them into a concise, review-friendly Markdown notebook.
    """
    lines = [
        "你是一个学习笔记整理助手。",
        "请基于以下逐页讲解内容，整理出一份紧凑的复习笔记。",
        "",
        "硬性要求：",
        "1. 不要重新讲课，只提炼要点。",
        "2. 每页笔记应比原讲解短得多——讲解是展开解释，笔记是精简提炼。",
        "3. 如果某页的讲解本身很简短（过渡页、标题页），笔记节也应简短，不要强行补充。",
        "4. 不要输出 callout（NOTE/TIP/WARNING）、考试技巧、记忆口诀。",
        "5. 用 <mark>...</mark> 标注关键定义和核心结论，每页 1-2 处，不要整段高亮。",
        "6. 必须使用中文，核心术语保留英文括注。",
        "7. 保持逐页结构不变，每页必须有自己的 ## 节。如果和前页重复，只在本页笔记中简写，并注明'本页主要补充……'，不要把两页合并。",
        "",
        f"文档名：{filename}",
        f"笔记标题：{title}",
        "",
        "输出格式：",
        "",
        f"# {filename} 笔记本",
        "",
        "## 第 N 页 · 标题",
        "- <mark>核心定义/结论</mark>",
        "- 要点 2",
        "- 要点 3",
        "- 术语 (English)：一句话解释",
        "",
        "（每页 3-6 条 bullet，不要超过 6 条。不需要子标题。）",
        "",
        "---",
        "",
        "下面是逐页讲解内容：",
        "",
    ]
    for item in explanations:
        lines.append(f"[第 {item.page_num} 页]")
        lines.append(item.markdown.strip())
        lines.append("")
    return "\n".join(lines).strip()


# Filler patterns commonly produced by LLMs that carry no information.
# Matched case-insensitively against stripped sentences.
_FILLER_PATTERNS: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"^这页在讲",
        r"^这一页在讲",
        r"^本页在讲",
        r"^上一页提到",
        r"^前面提到",
        r"^接下来我们",
        r"^让我们来看",
        r"^下面我们",
        r"^我们来看",
        r"^简单来说",
        r"^总的来说",
        r"^总之",
        r"^综上",
        r"^需要注意的是",
        r"^值得注意的是",
        r"^记住一句话",
        r"^考试技巧",
        r"^易错点",
        r"^记忆口诀",
        r"^补充说明",
        r"^这是一个过渡页",
        r"^这是封面",
        r"^这是目录",
        r"结合原讲解",
        r"补上自己的理解",
        r"参考原始讲解",
    ]
]


def _is_filler(sentence: str) -> bool:
    """Return True if *sentence* matches a known filler pattern."""
    return any(p.search(sentence) for p in _FILLER_PATTERNS)


def _has_substance(sentence: str) -> bool:
    """Return True if *sentence* is long enough and not filler."""
    return len(sentence) >= 8 and not _is_filler(sentence)


def _extract_marked_terms(md: str) -> list[str]:
    """Pull text inside <mark>...</mark> tags — these are the author's own highlights."""
    return [m.strip() for m in re.findall(r"<mark>(.+?)</mark>", md) if m.strip()]


def _extract_key_conclusion_bullets(md: str) -> list[str]:
    """Extract bullet points from '### 本页关键结论' section if present."""
    match = re.search(
        r"###\s*本页关键结论\s*\n(.*?)(?=\n###\s|\n##\s|\Z)",
        md,
        flags=re.DOTALL,
    )
    if not match:
        return []
    bullets = []
    for line in match.group(1).strip().splitlines():
        cleaned = line.strip().lstrip("-•* ").strip()
        if cleaned and _has_substance(cleaned):
            bullets.append(cleaned)
    return bullets


def _compress_sentence(sent: str, max_len: int = 60) -> str:
    """Shorten a sentence to its core clause, aiming for max_len chars."""
    if len(sent) <= max_len:
        return sent
    # Try splitting on common clause separators and take the first substantive part
    for sep in ("，即", "，也就是", "，因此", "，所以", "；", "，但"):
        parts = sent.split(sep, 1)
        if len(parts) == 2 and len(parts[0]) >= 10:
            compressed = parts[0].rstrip("，。；;:：、")
            if len(compressed) <= max_len:
                return compressed
    # Hard truncate at a natural boundary
    truncated = sent[:max_len]
    # Try to cut at last comma/period within the window
    for i in range(len(truncated) - 1, max(len(truncated) - 15, 0), -1):
        if truncated[i] in "，。；、":
            return truncated[: i].rstrip("，。；;:：、")
    return truncated.rstrip("，。；;:：、") + "…"


def build_notebook_fallback(
    *,
    filename: str,
    explanations: list[SlideExplanation],
) -> str:
    """Build a fallback notebook when LLM is unavailable.

    Strategy — prioritize already-compressed content over raw sentence extraction:
    1. Extract bullet points from "### 本页关键结论" (already the most condensed part).
    2. Extract <mark> highlights (author already picked these).
    3. Extract sentences with bilingual terms (definitional, high signal).
    4. Compress long sentences to their core clause instead of just truncating.
    5. Cap at 4 bullets per page, each ≤60 chars.
    """
    term_pattern = re.compile(r"[\u4e00-\u9fff].{0,10}\([A-Z]")

    lines = [default_notebook_markdown(filename).rstrip(), ""]
    for item in explanations:
        title = notebook_title_for_explanation(item)
        md = str(item.markdown or "").strip()

        if not md:
            lines.extend([
                f"## 第 {item.page_num} 页 · {title}",
                "- （内容较少，请参考原讲解）",
                "",
            ])
            continue

        bullets: list[str] = []
        used_texts: set[str] = set()

        # 1) Key conclusions first — these are already the most compressed
        for conclusion in _extract_key_conclusion_bullets(md):
            if len(bullets) >= 2:
                break
            compressed = _compress_sentence(conclusion)
            if compressed not in used_texts:
                bullets.append(f"- {compressed}")
                used_texts.add(compressed)

        # 2) Marked highlights — author's own picks
        for marked in _extract_marked_terms(md):
            if len(bullets) >= 3:
                break
            if len(marked) >= 4 and marked not in used_texts:
                compressed = _compress_sentence(marked)
                bullets.append(f"- <mark>{compressed}</mark>")
                used_texts.add(compressed)

        # 3) Fill remaining slots with term-bearing or high-signal sentences
        if len(bullets) < 4:
            candidates = _sentence_candidates(md)
            scored: list[tuple[float, str]] = []
            for sent in candidates:
                if not _has_substance(sent):
                    continue
                if any(sent in t for t in used_texts):
                    continue
                score = 0.0
                if term_pattern.search(sent):
                    score += 2.0
                slen = len(sent)
                if 15 <= slen <= 60:
                    score += 1.0
                elif 60 < slen <= 80:
                    score += 0.5
                scored.append((score, sent))

            scored.sort(key=lambda t: t[0], reverse=True)
            for _score, sent in scored[: 4 - len(bullets)]:
                compressed = _compress_sentence(sent)
                if compressed not in used_texts:
                    bullets.append(f"- {compressed}")
                    used_texts.add(compressed)

        if not bullets:
            bullets = ["- （内容较少，请参考原讲解）"]

        lines.extend([
            f"## 第 {item.page_num} 页 · {title}",
            *bullets,
            "",
        ])
    return "\n".join(lines).strip() + "\n"
