# Dual-Model Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-model explanation generation with a two-stage pipeline: qwen3-vl-flash (vision extraction) → qwen3.5-plus (text explanation), using Alibaba DashScope API.

**Architecture:** The `ModelGateway` gains a second model config (`VISION_MODEL` / `TEXT_MODEL`). A new `DualModelPipeline` class orchestrates two calls: (1) vision model reads slide image and outputs structured extraction in ~200-500 tokens, (2) text model takes PyMuPDF extraction + vision extraction and generates the full Chinese explanation. The existing `generate_slide_explanation()` function calls the pipeline instead of making a single vision call.

**Tech Stack:** Python 3.11, FastAPI, httpx, DashScope OpenAI-compatible API (`https://dashscope.aliyuncs.com/compatible-mode/v1`)

**API Key:** `$DASHSCOPE_API_KEY`
**Vision Model:** `qwen3-vl-flash`
**Text Model:** `qwen3.5-plus`
**Base URL:** `https://dashscope.aliyuncs.com/compatible-mode/v1`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `backend/.env` | Add dual-model env vars |
| `backend/app/services/model_gateway.py` | Add `generate_vision_extraction()` and `generate_text_completion()` methods |
| `backend/app/services/dual_pipeline.py` | **NEW** — Orchestrates vision→text two-stage pipeline |
| `backend/app/services/prompt_templates.py` | Add vision extraction prompt and text explanation prompt |
| `backend/app/services/explanation_engine.py` | Wire `DualModelPipeline` into `generate_slide_explanation()` |
| `backend/tests/test_dual_pipeline.py` | **NEW** — Unit tests for the pipeline |
| `scripts/eval_quality.py` | **NEW** — Quality evaluation script that Claude runs |

---

## Chunk 1: ModelGateway & DualModelPipeline

### Task 1: Configure environment variables

**Files:**
- Modify: `backend/.env`

- [ ] **Step 1: Update .env with dual-model configuration**

```env
# Dual-model pipeline configuration
# Vision model: reads slide images, outputs structured extraction
VISION_API_KEY=$DASHSCOPE_API_KEY
VISION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VISION_MODEL=qwen3-vl-flash

# Text model: generates full Chinese explanation from extraction
TEXT_API_KEY=$DASHSCOPE_API_KEY
TEXT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
TEXT_MODEL=qwen3.5-plus

# Legacy single-model config (still used for ROI and chat)
API_KEY=$DASHSCOPE_API_KEY
BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL=qwen3-vl-flash

CORS_ORIGINS=http://127.0.0.1:3000
```

- [ ] **Step 2: Commit**

```bash
git add backend/.env
git commit -m "feat: add dual-model pipeline env vars for DashScope API"
```

---

### Task 2: Add vision extraction prompt

**Files:**
- Modify: `backend/app/services/prompt_templates.py`

- [ ] **Step 1: Add the vision extraction prompt template**

Add after the existing `_ROI_PROMPT_TEMPLATE` (around line 136):

```python
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


def build_vision_extraction_prompt(*, extraction_text: str) -> str:
    return _VISION_EXTRACTION_PROMPT.format(
        extraction_text=extraction_text or "（无 PyMuPDF 提取结果）",
    )
```

- [ ] **Step 2: Add the text explanation prompt template**

Add after the vision extraction prompt:

```python
_TEXT_EXPLANATION_PROMPT = """\
你是一个精通理工科课程的讲师，受众是正在自学的大学生。你要基于"结构化提取结果"和"视觉模型提取结果"输出高质量讲解。

**信息来源：**
1. PyMuPDF 结构化提取（程序自动提取的文字和结构）
2. 视觉模型提取（AI 读取截图后描述的图表、公式、布局等视觉信息）
两者互补，冲突时以视觉模型提取为准（因为它基于实际截图）。

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
6. 图表描述要说明它与正文的关系。
7. 只依据两份提取结果能支持的内容；信息不足时明确说"页面未明确给出"，不要编造。
8. **输出篇幅必须与页面信息量成正比——内容少就写少，不要硬凑。**

**输出格式（只输出实际存在的节，不存在的节直接省略）：**

## [页面实际标题]

### 完整翻译与解释
将页面可见文字完整翻译并解释，写成连贯讲解。

### 例题完整讲解
（仅当页面含例题时输出）

### 知识点总结
（仅当页面含知识点时输出）

### 重复部分讲解
（仅当与前序页存在明显重复时输出）

当前页码：{page_num}
相关页码：{related}
用户问题：{question}

PyMuPDF 结构化提取：
{extraction_text}

视觉模型提取：
{vision_extraction}
"""


def build_text_explanation_prompt(
    *,
    page_num: int,
    question: str,
    extraction_text: str,
    vision_extraction: str,
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
    return _TEXT_EXPLANATION_PROMPT.format(
        page_num=page_num,
        related=related,
        question=question,
        extraction_text=(
            (extraction_text or "（无稳定提取文本）")
            + repeat_context
        ),
        vision_extraction=vision_extraction or "（视觉模型未返回结果）",
    )
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/prompt_templates.py
git commit -m "feat: add vision extraction and text explanation prompt templates"
```

---

### Task 3: Extend ModelGateway with dual-model support

**Files:**
- Modify: `backend/app/services/model_gateway.py`

- [ ] **Step 1: Add `generate_vision_extraction()` method**

Add to the `ModelGateway` class after `generate_text_markdown()` (around line 103):

```python
def generate_vision_extraction(
    self,
    *,
    prompt: str,
    slide_image_path: Path,
) -> str:
    """Call vision model with image to extract visual content. Short output."""
    payload = self._build_payload(
        prompt_text=prompt,
        image_paths=[slide_image_path],
    )
    # Limit output tokens for extraction (short, structured output)
    if not self._is_anthropic:
        payload["max_tokens"] = 1024
    return self._post_chat_completion(payload)
```

No other changes needed — the existing `generate_text_markdown()` already handles text-only calls, which is exactly what the text model step needs.

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/model_gateway.py
git commit -m "feat: add generate_vision_extraction method to ModelGateway"
```

---

### Task 4: Create DualModelPipeline

**Files:**
- Create: `backend/app/services/dual_pipeline.py`

- [ ] **Step 1: Write the DualModelPipeline class**

```python
from __future__ import annotations

import logging
import os
from collections.abc import Iterable
from pathlib import Path

from app.services.model_gateway import ModelGateway
from app.services.prompt_templates import (
    build_vision_extraction_prompt,
    build_text_explanation_prompt,
)

logger = logging.getLogger(__name__)


class DualModelPipeline:
    """Two-stage pipeline: vision model extracts → text model explains."""

    def __init__(
        self,
        *,
        vision_gateway: ModelGateway | None = None,
        text_gateway: ModelGateway | None = None,
    ) -> None:
        self.vision_gateway = vision_gateway or ModelGateway(
            api_key=os.getenv("VISION_API_KEY", ""),
            base_url=os.getenv("VISION_BASE_URL", ""),
            model=os.getenv("VISION_MODEL", ""),
            timeout=120.0,
        )
        self.text_gateway = text_gateway or ModelGateway(
            api_key=os.getenv("TEXT_API_KEY", ""),
            base_url=os.getenv("TEXT_BASE_URL", ""),
            model=os.getenv("TEXT_MODEL", ""),
            timeout=120.0,
        )

    def is_configured(self) -> bool:
        return self.vision_gateway.is_configured() and self.text_gateway.is_configured()

    def generate(
        self,
        *,
        slide_image_path: Path,
        extraction_text: str,
        page_num: int,
        question: str,
        related_pages: Iterable[int],
        repeat_analysis: dict | None = None,
    ) -> str:
        """Run the two-stage pipeline and return explanation markdown."""

        # Stage 1: Vision model reads the image
        vision_prompt = build_vision_extraction_prompt(
            extraction_text=extraction_text,
        )
        logger.info("Dual pipeline stage 1: vision extraction for page %d", page_num)
        vision_extraction = self.vision_gateway.generate_vision_extraction(
            prompt=vision_prompt,
            slide_image_path=slide_image_path,
        )
        logger.info(
            "Vision extraction complete: %d chars",
            len(vision_extraction),
        )

        # Stage 2: Text model generates explanation
        text_prompt = build_text_explanation_prompt(
            page_num=page_num,
            question=question,
            extraction_text=extraction_text,
            vision_extraction=vision_extraction,
            related_pages=related_pages,
            repeat_analysis=repeat_analysis,
        )
        logger.info("Dual pipeline stage 2: text explanation for page %d", page_num)
        explanation = self.text_gateway.generate_text_markdown(
            prompt=text_prompt,
        )
        logger.info(
            "Text explanation complete: %d chars",
            len(explanation),
        )

        return explanation
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/dual_pipeline.py
git commit -m "feat: add DualModelPipeline orchestrating vision→text two-stage generation"
```

---

### Task 5: Wire DualModelPipeline into explanation_engine.py

**Files:**
- Modify: `backend/app/services/explanation_engine.py`

- [ ] **Step 1: Add DualModelPipeline import**

Add to imports at top of file (after existing imports):

```python
from app.services.dual_pipeline import DualModelPipeline
```

- [ ] **Step 2: Modify `generate_slide_explanation()` to try dual pipeline first**

Replace the section in `generate_slide_explanation()` that calls the model (lines ~605-622) with logic that tries the dual pipeline first, falls back to single model, then falls back to template:

Replace this block (lines 605-633):
```python
    degraded = False
    if slide_image_path:
        live_gateway = gateway or ModelGateway()
        try:
            answer = live_gateway.generate_slide_markdown(
                prompt=prompt_contract,
                slide_image_path=slide_image_path,
                extraction_text=prompt_extraction_text,
            )
            canonical_markdown, meta = _canonicalize_slide_explanation(
                slide=slide,
                markdown=answer,
                extracted_text=extracted_text,
                extract_payload=extract_payload,
                related_pages=related_pages,
                question=question,
            )
            return canonical_markdown, follow_ups, degraded, meta
        except Exception:
            degraded = True

    answer, meta = _template_slide_explanation(
        slide=slide,
        question=question,
        extracted_text=extracted_text,
        extract_payload=extract_payload,
        related_pages=related_pages,
    )
    return answer, follow_ups, degraded, meta
```

With:
```python
    degraded = False
    if slide_image_path:
        # Try dual pipeline first (vision + text models)
        dual = DualModelPipeline()
        if dual.is_configured():
            try:
                answer = dual.generate(
                    slide_image_path=slide_image_path,
                    extraction_text=prompt_extraction_text,
                    page_num=slide.page_num,
                    question=question,
                    related_pages=related_pages,
                    repeat_analysis=(extract_payload or {}).get("repeat_analysis"),
                )
                canonical_markdown, meta = _canonicalize_slide_explanation(
                    slide=slide,
                    markdown=answer,
                    extracted_text=extracted_text,
                    extract_payload=extract_payload,
                    related_pages=related_pages,
                    question=question,
                )
                meta["pipeline"] = "dual"
                return canonical_markdown, follow_ups, degraded, meta
            except Exception:
                pass  # Fall through to single-model

        # Fallback: single vision model
        live_gateway = gateway or ModelGateway()
        if live_gateway.is_configured():
            try:
                answer = live_gateway.generate_slide_markdown(
                    prompt=prompt_contract,
                    slide_image_path=slide_image_path,
                    extraction_text=prompt_extraction_text,
                )
                canonical_markdown, meta = _canonicalize_slide_explanation(
                    slide=slide,
                    markdown=answer,
                    extracted_text=extracted_text,
                    extract_payload=extract_payload,
                    related_pages=related_pages,
                    question=question,
                )
                meta["pipeline"] = "single"
                return canonical_markdown, follow_ups, degraded, meta
            except Exception:
                degraded = True

    answer, meta = _template_slide_explanation(
        slide=slide,
        question=question,
        extracted_text=extracted_text,
        extract_payload=extract_payload,
        related_pages=related_pages,
    )
    meta["pipeline"] = "template"
    return answer, follow_ups, degraded, meta
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/explanation_engine.py
git commit -m "feat: wire dual pipeline into explanation generation with fallback chain"
```

---

## Chunk 2: Quality Evaluation & Testing

### Task 6: Create quality evaluation script

**Files:**
- Create: `scripts/eval_quality.py`

This script:
1. Picks a diverse set of test slides from the database
2. Calls the dual pipeline to generate new explanations
3. Outputs the results as JSON for Claude to evaluate

- [ ] **Step 1: Write the evaluation script**

```python
#!/usr/bin/env python3
"""
Generate explanations for sample slides using the dual pipeline,
then output results for quality evaluation.

Usage:
    cd backend && python3 ../scripts/eval_quality.py

Output: writes results to ../scripts/eval_results.json
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
os.chdir(Path(__file__).resolve().parent.parent / "backend")

from dotenv import load_dotenv
load_dotenv()

from app.services.dual_pipeline import DualModelPipeline
from app.services.prompt_templates import build_vision_extraction_prompt, build_text_explanation_prompt


# Test pages: diverse content types and courses
TEST_PAGES = [
    # (document_filename_pattern, page_num, reason)
    ("AMA1500_Lecture5", 31, "math example page"),
    ("AMA1500_Lecture9", 14, "math concept page"),
    ("Ch2-ApplicationLayer", 65, "CS networking concept"),
    ("Lecture_2.pdf", 23, "CS data structures"),
    ("Lec03_Linux", 30, "OS/Linux concept"),
    ("L3-Lecture-Image.processing2", 8, "image processing with formulas"),
    ("Supervised Learning-NN", 15, "neural network concept"),
    ("AMA1500_Lecture11", 20, "math example with solution"),
]


def find_slide(conn: sqlite3.Connection, filename_pattern: str, page_num: int):
    """Find a slide by filename pattern and page number."""
    row = conn.execute(
        """
        SELECT s.id, s.document_id, s.image_path, d.filename,
               se.markdown as existing_explanation,
               sx.payload as extract_payload
        FROM slide s
        JOIN document d ON d.id = s.document_id
        LEFT JOIN slideexplanation se ON se.slide_id = s.id
        LEFT JOIN slideextract sx ON sx.slide_id = s.id
        WHERE d.filename LIKE ? AND s.page_num = ?
        """,
        (f"%{filename_pattern}%", page_num),
    ).fetchone()
    return row


def main():
    conn = sqlite3.connect("storage/app.db")
    pipeline = DualModelPipeline()

    if not pipeline.is_configured():
        print("ERROR: Dual pipeline not configured. Check .env")
        sys.exit(1)

    results = []
    for filename_pattern, page_num, reason in TEST_PAGES:
        print(f"\n{'='*60}")
        print(f"Processing: {filename_pattern} page {page_num} ({reason})")
        print(f"{'='*60}")

        row = find_slide(conn, filename_pattern, page_num)
        if not row:
            print(f"  SKIP: not found in database")
            results.append({
                "file": filename_pattern,
                "page": page_num,
                "reason": reason,
                "status": "not_found",
            })
            continue

        slide_id, doc_id, image_path, filename, existing_md, extract_payload_json = row
        image_full_path = Path("storage") / doc_id / "slides" / f"slide_{page_num:03d}.png"

        if not image_full_path.exists():
            print(f"  SKIP: image not found at {image_full_path}")
            results.append({
                "file": filename,
                "page": page_num,
                "reason": reason,
                "status": "image_not_found",
            })
            continue

        extract_payload = json.loads(extract_payload_json) if extract_payload_json else {}

        # Build extraction text (same as explanation_engine does)
        from app.services.explanation_engine import _extraction_text_for_prompt
        extraction_text = _extraction_text_for_prompt(
            extract_payload.get("raw_text", ""),
            extract_payload,
        )

        try:
            # Stage 1: Vision extraction
            vision_prompt = build_vision_extraction_prompt(extraction_text=extraction_text)
            vision_result = pipeline.vision_gateway.generate_vision_extraction(
                prompt=vision_prompt,
                slide_image_path=image_full_path,
            )

            # Stage 2: Text explanation
            text_prompt = build_text_explanation_prompt(
                page_num=page_num,
                question="请讲解这一页的内容",
                extraction_text=extraction_text,
                vision_extraction=vision_result,
                related_pages=[page_num],
                repeat_analysis=extract_payload.get("repeat_analysis"),
            )
            new_explanation = pipeline.text_gateway.generate_text_markdown(
                prompt=text_prompt,
            )

            print(f"  Vision extraction: {len(vision_result)} chars")
            print(f"  New explanation: {len(new_explanation)} chars")
            print(f"  Existing explanation: {len(existing_md or '')} chars")

            results.append({
                "file": filename,
                "page": page_num,
                "reason": reason,
                "status": "success",
                "vision_extraction": vision_result,
                "new_explanation": new_explanation,
                "existing_explanation": existing_md or "",
                "extraction_text_preview": extraction_text[:500],
            })
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({
                "file": filename,
                "page": page_num,
                "reason": reason,
                "status": "error",
                "error": str(e),
            })

    output_path = Path(__file__).resolve().parent / "eval_results.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n\nResults saved to {output_path}")
    print(f"Total: {len(results)} pages, {sum(1 for r in results if r['status'] == 'success')} successful")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add scripts/eval_quality.py
git commit -m "feat: add quality evaluation script for dual pipeline testing"
```

---

### Task 7: Create quality evaluation prompt for Claude

**Files:**
- Create: `scripts/eval_prompt.md`

This is the prompt Claude will use to evaluate generated explanations against existing (Claude-generated) ones.

- [ ] **Step 1: Write the evaluation prompt**

```markdown
# PPT 讲解质量评估 Prompt

对于每一页 PPT，你会看到：
1. **页面信息**：文件名、页码、内容类型
2. **视觉模型提取结果**：qwen3-vl-flash 从图片中提取的内容
3. **新生成的讲解**：双模型流水线（qwen3-vl-flash + qwen3.5-plus）生成的讲解
4. **基准讲解**：Claude 直接看图生成的讲解（作为质量基准）

请从以下 6 个维度打分（每项 1-5 分），并给出简要评语：

## 评分维度

### 1. 完整性 (Completeness) — 1-5 分
- 页面上所有可见文字是否都被翻译/提及？
- 公式、图表、代码是否都有覆盖？
- 5 分 = 无遗漏；3 分 = 遗漏了次要内容；1 分 = 遗漏了核心内容

### 2. 准确性 (Accuracy) — 1-5 分
- 翻译是否正确？术语是否准确？
- 公式转写是否正确（LaTeX/KaTeX）？
- 是否有编造/幻觉内容？
- 5 分 = 完全准确；3 分 = 有小错但不影响理解；1 分 = 有严重错误

### 3. 深度 (Depth) — 1-5 分
- 是否解释了"为什么"而不只是"是什么"？
- 晦涩概念是否有直觉解释？
- 跳步推导是否有补充？
- 5 分 = 深入透彻；3 分 = 基本解释到位；1 分 = 流于表面

### 4. 结构 (Structure) — 1-5 分
- 是否按照要求的格式输出（翻译→讲解→重复）？
- 段落是否连贯，是否有碎片化短句？
- Markdown 格式是否正确？
- 5 分 = 结构清晰；3 分 = 大致合格；1 分 = 混乱

### 5. 语言质量 (Language Quality) — 1-5 分
- 中文是否自然流畅？
- 术语格式是否正确（中文（English））？
- 是否有机翻感？
- 5 分 = 自然流畅；3 分 = 可读但略生硬；1 分 = 机翻感严重

### 6. 篇幅适当性 (Proportionality) — 1-5 分
- 输出长度是否与页面信息量成正比？
- 是否有水字数/硬凑的现象？
- 5 分 = 恰到好处；3 分 = 略长或略短；1 分 = 严重失衡

## 输出格式

对每一页输出：

```
### [文件名] 第 X 页 — [内容类型]

| 维度 | 分数 | 评语 |
|------|------|------|
| 完整性 | X/5 | ... |
| 准确性 | X/5 | ... |
| 深度 | X/5 | ... |
| 结构 | X/5 | ... |
| 语言质量 | X/5 | ... |
| 篇幅适当性 | X/5 | ... |
| **总分** | **XX/30** | |

**与基准对比**：[比基准好/相当/略差/明显差] — [具体说明差异]

**关键问题**：[如果有的话列出最需要改进的 1-2 点]
```

最后输出总体评估：
- 平均总分
- 双模型 vs 单模型 Claude 的整体质量差距
- 是否达到可部署标准（≥22/30 为合格）
- 改进建议
```

- [ ] **Step 2: Commit**

```bash
git add scripts/eval_prompt.md
git commit -m "feat: add quality evaluation prompt for Claude-based assessment"
```

---

### Task 8: Run the pipeline and evaluate

- [ ] **Step 1: Run the evaluation script**

```bash
cd /Users/shihaochen/github/Teaching-Learning-/backend
python3 ../scripts/eval_quality.py
```

Expected: generates `scripts/eval_results.json` with 8 test pages

- [ ] **Step 2: Claude reads eval_results.json and slide images**

For each successful result in eval_results.json:
1. Read the slide image to understand the actual page content
2. Read the vision extraction, new explanation, and existing explanation
3. Apply the evaluation prompt to score the new explanation
4. Compare with the existing (Claude-generated) explanation as baseline

- [ ] **Step 3: Report evaluation results**

Output the full evaluation report with scores and recommendations.

---

## Summary

**Pipeline flow:**
```
PDF Upload → PyMuPDF extract → slide images saved
                                      ↓
                              qwen3-vl-flash (vision)
                              "提取所有视觉内容"
                              ~200-500 tokens output
                                      ↓
                              qwen3.5-plus (text)
                              PyMuPDF + vision extraction → full explanation
                              ~1000-2000 tokens output
                                      ↓
                              _canonicalize_slide_explanation()
                              → structured meta + markdown
                              → saved to SlideExplanation
```

**Fallback chain:**
1. Dual pipeline (vision + text) — preferred
2. Single vision model — if dual not configured
3. Template fallback — if all API calls fail

**Cost estimate per page:**
- Vision: ~500 input tokens (image) + ~300 output tokens ≈ 0.0005 元
- Text: ~1500 input tokens + ~1500 output tokens ≈ 0.008 元
- Total: **~0.01 元/页** → 100 页 ≈ 1 元
