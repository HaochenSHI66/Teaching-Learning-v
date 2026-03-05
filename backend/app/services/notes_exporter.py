from __future__ import annotations

from collections import defaultdict


def build_markdown(*, title: str, notes_by_slide: list[tuple[int, str]]) -> str:
    grouped: dict[int, list[str]] = defaultdict(list)
    for page_num, content in notes_by_slide:
        grouped[page_num].append(content)

    lines = [f"# {title}", ""]
    for page_num in sorted(grouped.keys()):
        lines.append(f"## Slide {page_num}")
        lines.append("")
        lines.extend(grouped[page_num])
        lines.append("")

    return "\n".join(lines).strip() + "\n"
