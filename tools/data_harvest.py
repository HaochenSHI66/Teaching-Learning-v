#!/usr/bin/env python3
"""
data_harvest.py — 从 production SQLite DB 抽取 SFT 训练三元组

输出格式：Unsloth Qwen3-VL 标准 JSONL
  每行一条：{"messages": [system, user(image+text), assistant]}

用法：
  python tools/data_harvest.py \
      --db /path/to/app.db \
      --storage-dir /path/to/storage \
      --output tools/data/harvest.jsonl \
      --days 180 \
      --limit 15000 \
      --min-chars 80
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone


_SYSTEM_PROMPT = """\
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

讲解原则：
1. 严格按 PPT 原始顺序讲解，不要重新组织结构或打乱顺序。
2. 只讲页面上有的内容，不要添加 PPT 上没有的背景知识。
3. 代码/数字/公式必须具体讲解其含义和计算过程。
4. 按知识点分组，一页通常 2-3 个要点就够。
5. 单个一级 bullet 下的二级 bullet 不超过 4 条。
6. 每个核心点写成：**标签：**1-2 句解释。
7. 禁止连续复读原文：用学生能听懂的话重新组织，解释"为什么"和"怎么用"。
8. 口语化，写得像老师在白板边讲，短句优先（每句 ≤25 字）。
9. 引用视觉元素必须点名位置（"右上角的流程图""左下角公式"）。
10. 专业术语首次出现写成：**中文 (English)**，同页后续只写中文。

格式：
## 第 N 页：PPT原始标题 — 中文主题

- **标签1：**解释内容
- **标签2：**解释内容

禁止：callout、blockquote、散文长段落。"""


def _extract_text_from_payload(payload_raw: str | None) -> str:
    """从 SlideExtract.payload JSON 中提取文本。"""
    if not payload_raw:
        return ""
    try:
        if isinstance(payload_raw, str):
            payload = json.loads(payload_raw)
        else:
            payload = payload_raw
        # payload 可能直接是 {"text": "..."} 或 {"extracted_text": "..."}
        for key in ("text", "extracted_text", "content", "raw_text"):
            if key in payload and isinstance(payload[key], str):
                return payload[key].strip()
        # fallback：把所有字符串值拼起来
        parts = [v for v in payload.values() if isinstance(v, str) and v.strip()]
        return "\n".join(parts)
    except (json.JSONDecodeError, AttributeError):
        return ""


def build_messages(page_num: int, image_abs_path: str, extraction_text: str, explanation: str) -> list[dict]:
    user_content: list[dict] = [
        {"type": "image", "image": f"file://{image_abs_path}"},
    ]
    text_part = f"第 {page_num} 页"
    if extraction_text:
        text_part += f"\n\n【OCR文本参考】\n{extraction_text[:1200]}"
    user_content.append({"type": "text", "text": text_part})

    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
        {"role": "assistant", "content": explanation},
    ]


def harvest(
    db_path: Path,
    storage_dir: Path,
    output_path: Path,
    *,
    days: int,
    limit: int,
    min_chars: int,
) -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    query = """
        SELECT
            se.page_num,
            se.markdown       AS explanation,
            sl.image_path     AS slide_image_path,
            d.storage_path    AS doc_storage_path,
            sx.payload        AS extract_payload
        FROM slideexplanation se
        JOIN slide sl ON sl.id = se.slide_id
        JOIN document d  ON d.id  = se.document_id
        LEFT JOIN slideextract sx ON sx.slide_id = sl.id
        WHERE se.generated_at >= ?
          AND length(se.markdown) >= ?
        ORDER BY se.generated_at DESC
        LIMIT ?
    """

    rows = con.execute(query, (cutoff, min_chars, limit)).fetchall()
    con.close()

    print(f"查询到 {len(rows)} 条记录，开始过滤...", file=sys.stderr)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    written = skipped_missing = skipped_short = 0

    with output_path.open("w", encoding="utf-8") as fout:
        for row in rows:
            img_abs = storage_dir / row["doc_storage_path"] / row["slide_image_path"]
            if not img_abs.exists():
                skipped_missing += 1
                continue

            explanation = (row["explanation"] or "").strip()
            if len(explanation) < min_chars:
                skipped_short += 1
                continue

            extraction_text = _extract_text_from_payload(row["extract_payload"])
            messages = build_messages(
                page_num=row["page_num"],
                image_abs_path=str(img_abs.resolve()),
                extraction_text=extraction_text,
                explanation=explanation,
            )
            fout.write(json.dumps({"messages": messages}, ensure_ascii=False) + "\n")
            written += 1

    print(
        f"完成：写入 {written} 条 | 图片缺失跳过 {skipped_missing} | 内容过短跳过 {skipped_short}",
        file=sys.stderr,
    )
    print(f"输出：{output_path}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="从 production DB 抽取 SFT 训练三元组")
    parser.add_argument("--db", required=True, help="SQLite DB 路径，如 /path/to/app.db")
    parser.add_argument("--storage-dir", required=True, help="storage 根目录，如 /path/to/storage")
    parser.add_argument("--output", default="tools/data/harvest.jsonl", help="输出 JSONL 路径")
    parser.add_argument("--days", type=int, default=180, help="抽取最近 N 天的数据（默认 180）")
    parser.add_argument("--limit", type=int, default=15000, help="最多抽取条数（默认 15000）")
    parser.add_argument("--min-chars", type=int, default=80, help="讲解最小字符数（默认 80）")
    args = parser.parse_args()

    harvest(
        db_path=Path(args.db),
        storage_dir=Path(args.storage_dir),
        output_path=Path(args.output),
        days=args.days,
        limit=args.limit,
        min_chars=args.min_chars,
    )


if __name__ == "__main__":
    main()
