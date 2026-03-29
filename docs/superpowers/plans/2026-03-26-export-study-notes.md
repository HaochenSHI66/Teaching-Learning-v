# One-Click Export Beautiful Study Notes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual notebook editor with a one-click "export beautiful study notes" feature that generates styled PDF/HTML notes from existing AI-generated content.

**Architecture:** Backend Jinja2 HTML templates with 3 CSS themes → WeasyPrint PDF rendering. Single LLM call generates a study summary; all other content is template-rendered from existing data (explanations, extractions, concepts, flashcards). Frontend modal for style selection, content toggles, preview, and download.

**Tech Stack:** Jinja2 + WeasyPrint (backend), React modal component (frontend), existing DashScope LLM API (summary only)

---

## File Structure

### Backend — New Files
| File | Responsibility |
|------|---------------|
| `backend/app/api/export_notes.py` | FastAPI router: `/api/v1/export-notes/{document_id}` (preview HTML + download PDF) |
| `backend/app/services/notes_renderer.py` | Gathers all data, calls LLM for summary, renders Jinja2 template |
| `backend/app/templates/study_notes.html` | Jinja2 HTML template for the notes document |
| `backend/app/templates/styles/clean-academic.css` | Style 1: serif, blue accent, textbook feel |
| `backend/app/templates/styles/modern-minimal.css` | Style 2 (default): sans-serif, teal, card-based |
| `backend/app/templates/styles/warm-notebook.css` | Style 3: handwritten font, warm brown, cream bg |

### Backend — Modified Files
| File | Change |
|------|--------|
| `backend/app/main.py` | Register `export_notes` router |
| `backend/app/schemas.py` | Add `ExportNotesRequest` and `ExportNotesResponse` schemas |
| `backend/pyproject.toml` | Add `jinja2` and `weasyprint` dependencies |

### Frontend — New Files
| File | Responsibility |
|------|---------------|
| `frontend/components/export-notes-modal.tsx` | Modal with style picker, content toggles, preview, download |

### Frontend — Modified Files
| File | Change |
|------|--------|
| `frontend/app/page.tsx` | Replace NotebookWindow with ExportNotesModal; replace notebook button with export button |
| `frontend/lib/api.ts` | Add `exportStyledNotes()` and `downloadStyledNotesPdf()` API functions |
| `frontend/components/ai-panel.tsx` | Remove unused notebook-related props |

### Frontend — Files to Delete
| File | Reason |
|------|--------|
| `frontend/components/notebook-window.tsx` | Replaced by export modal |
| `frontend/components/note-editor.tsx` | No longer needed — no manual editing |

---

## Chunk 1: Backend — Data Gathering & LLM Summary

### Task 1: Add dependencies

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Add jinja2 and weasyprint to dependencies**

In `backend/pyproject.toml`, add to the `dependencies` list:

```toml
  "jinja2>=3.1.0",
  "weasyprint>=62.0",
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
cd /Users/shihaochen/github/Teaching-Learning-/backend
pip install jinja2 weasyprint
```

Expected: Both install successfully. WeasyPrint requires system libs (cairo, pango) — on macOS: `brew install cairo pango gdk-pixbuf libffi` if not already present.

- [ ] **Step 3: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add backend/pyproject.toml
git commit -m "feat: add jinja2 and weasyprint dependencies for notes export"
```

---

### Task 2: Add request/response schemas

**Files:**
- Modify: `backend/app/schemas.py` (append at end)

- [ ] **Step 1: Add ExportNotesRequest and ExportNotesResponse schemas**

Append to `backend/app/schemas.py`:

```python
# ── Export Styled Notes ────────────────────────────────────────

class ExportNotesRequest(BaseModel):
    style: str = "modern-minimal"  # clean-academic | modern-minimal | warm-notebook
    format: str = "html"  # html | pdf
    include_images: bool = True
    include_explanations: bool = True
    include_key_terms: bool = True
    include_knowledge_map: bool = True
    include_flashcards: bool = True


class ExportNotesStyle(BaseModel):
    id: str
    name: str
    name_zh: str
    description: str
    color_primary: str
    color_accent: str


class ExportNotesStylesResponse(BaseModel):
    styles: list[ExportNotesStyle]


class ExportNotesPreviewResponse(BaseModel):
    html: str
    title: str
    page_count: int
    concept_count: int
```

- [ ] **Step 2: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add backend/app/schemas.py
git commit -m "feat: add export notes request/response schemas"
```

---

### Task 3: Build the data-gathering and rendering service

**Files:**
- Create: `backend/app/services/notes_renderer.py`

This is the core service. It:
1. Fetches all slides, explanations, extractions, concepts, flashcards from DB
2. Makes one LLM call for a study summary
3. Renders Jinja2 template with data + selected CSS style
4. Optionally converts HTML to PDF via WeasyPrint

- [ ] **Step 1: Create the notes_renderer service**

Create `backend/app/services/notes_renderer.py`:

```python
"""Renders beautiful study notes from existing data using Jinja2 templates."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader
from sqlmodel import Session, select

from app.models import (
    Concept,
    ConceptRelation,
    Flashcard,
    Slide,
    SlideExplanation,
    SlideExtract,
)
from app.services.model_gateway import ModelGateway

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates"

VALID_STYLES = {"clean-academic", "modern-minimal", "warm-notebook"}

STYLE_META = [
    {
        "id": "clean-academic",
        "name": "Clean Academic",
        "name_zh": "清晰学术风",
        "description": "宋体标题，深蓝色调，教科书质感，适合打印",
        "color_primary": "#1a365d",
        "color_accent": "#2b6cb0",
    },
    {
        "id": "modern-minimal",
        "name": "Modern Minimal",
        "name_zh": "现代简约风",
        "description": "无衬线字体，青绿色调，圆角卡片，适合屏幕阅读",
        "color_primary": "#2d3748",
        "color_accent": "#319795",
    },
    {
        "id": "warm-notebook",
        "name": "Warm Notebook",
        "name_zh": "温暖笔记风",
        "description": "手写风标题，暖棕配色，奶油背景，轻松学习氛围",
        "color_primary": "#5d4037",
        "color_accent": "#e65100",
    },
]

SUMMARY_PROMPT = """你是一位优秀的大学学习助手。根据以下课件内容，为学生写一段学习总结（3-5句话）。

要求：
1. 用简洁清晰的中文概括本节课的核心主题和最重要的概念
2. 点明各概念之间的逻辑关系（因果、递进、对比等）
3. 最后一句话给出学习建议（例如：重点复习哪个概念、注意哪个易混淆点）
4. 总字数控制在150-250字
5. 不要使用"本课件"、"本PPT"等说法，直接用"这节课"或"本节内容"

课件标题：{title}

各页核心内容：
{slide_summaries}

高重要性概念（重要度>=4）：
{high_importance_concepts}

概念关系：
{concept_relationships}"""


def _generate_study_summary(
    *,
    title: str,
    slides_data: list[dict],
    concepts: list[Concept],
    relations: list[ConceptRelation],
) -> str:
    """Generate a 3-5 sentence study summary using LLM. Returns empty string on failure."""
    gw = ModelGateway()
    if not gw.is_configured():
        return ""

    # Build slide summaries (one line per slide)
    slide_lines = []
    for s in slides_data:
        page = s.get("page_num", "?")
        stitle = s.get("title", f"第{page}页")
        points = s.get("key_points", [])
        first = points[0] if points else ""
        slide_lines.append(f"第{page}页 [{stitle}]: {first}")

    # High importance concepts
    high = [c for c in concepts if (c.importance or 3) >= 4]
    concept_lines = [
        f"- {c.name}（重要度{c.importance}）: {c.description}" for c in high
    ]

    # Concept name lookup for relations
    name_map = {c.id: c.name for c in concepts}
    rel_lines = [
        f"- {name_map.get(r.source_id, '?')} → {r.relation_type} → {name_map.get(r.target_id, '?')}"
        for r in relations
    ]

    prompt = SUMMARY_PROMPT.format(
        title=title,
        slide_summaries="\n".join(slide_lines) or "（无内容）",
        high_importance_concepts="\n".join(concept_lines) or "（无）",
        concept_relationships="\n".join(rel_lines) or "（无）",
    )

    try:
        return gw.generate_text_markdown(prompt=prompt).strip()
    except Exception as e:
        logger.warning("Failed to generate study summary: %s", e)
        return ""


def gather_export_data(
    *,
    db: Session,
    document_id: str,
    include_images: bool = True,
    include_explanations: bool = True,
    include_key_terms: bool = True,
    include_knowledge_map: bool = True,
    include_flashcards: bool = True,
    storage_dir: str = "./storage",
) -> dict:
    """Gather all data needed for notes rendering into a plain dict."""
    from app.models import Document

    # Document
    doc = db.get(Document, document_id)
    doc_title = doc.filename if doc else "学习笔记"

    # Slides (ordered by page_num)
    slides = db.exec(
        select(Slide)
        .where(Slide.document_id == document_id)
        .order_by(Slide.page_num)
    ).all()

    # Explanations keyed by slide_id
    explanations = db.exec(
        select(SlideExplanation).where(
            SlideExplanation.document_id == document_id
        )
    ).all()
    expl_map = {e.slide_id: e for e in explanations}

    # Extractions keyed by slide_id
    extractions = db.exec(
        select(SlideExtract).where(SlideExtract.document_id == document_id)
    ).all()
    extract_map = {e.slide_id: e for e in extractions}

    # Knowledge graph
    concepts: list[Concept] = []
    relations: list[ConceptRelation] = []
    if include_knowledge_map:
        concepts = list(
            db.exec(select(Concept).where(Concept.document_id == document_id)).all()
        )
        concept_ids = {c.id for c in concepts}
        if concept_ids:
            relations = list(
                db.exec(
                    select(ConceptRelation).where(
                        ConceptRelation.source_id.in_(concept_ids)  # type: ignore[attr-defined]
                    )
                ).all()
            )

    # Flashcards
    flashcards: list[Flashcard] = []
    if include_flashcards:
        flashcards = list(
            db.exec(
                select(Flashcard)
                .where(Flashcard.document_id == document_id)
                .order_by(Flashcard.slide_id)
            ).all()
        )

    # Build per-slide data
    slides_data = []
    for slide in slides:
        expl = expl_map.get(slide.id)
        ext = extract_map.get(slide.id)

        # Parse extraction payload for key terms / formulas
        payload = ext.payload if ext else {}
        blocks = payload.get("blocks", [])
        key_terms = []
        formulas = []
        key_points = []
        for block in blocks:
            if block.get("type") == "key_term":
                key_terms.append(block)
            elif block.get("type") == "formula":
                formulas.append(block)
            elif block.get("type") == "bullet_list":
                for item in block.get("items", []):
                    key_points.append(item if isinstance(item, str) else str(item))

        title_candidates = payload.get("title_candidates", [])
        slide_title = title_candidates[0] if title_candidates else f"第 {slide.page_num} 页"

        explanation_md = expl.markdown if expl and include_explanations else ""
        meta = expl.meta if expl else {}

        # Image URL
        image_url = ""
        if include_images and slide.image_path:
            image_url = f"/storage/{document_id}/{slide.image_path}"

        # Skip near-empty slides
        has_content = bool(explanation_md.strip()) or bool(key_points) or bool(key_terms)

        slides_data.append({
            "page_num": slide.page_num,
            "slide_id": slide.id,
            "title": slide_title,
            "image_url": image_url,
            "explanation_md": explanation_md,
            "meta": meta,
            "key_points": key_points,
            "key_terms": key_terms,
            "formulas": formulas,
            "has_content": has_content,
        })

    # Concept name lookup for relations display
    concept_name_map = {c.id: c.name for c in concepts}

    return {
        "title": doc_title.replace(".pdf", "").replace(".pptx", "").replace(".ppt", ""),
        "export_date": datetime.now().strftime("%Y-%m-%d"),
        "total_slides": len(slides),
        "total_concepts": len(concepts),
        "total_flashcards": len(flashcards),
        "slides": slides_data,
        "concepts": sorted(concepts, key=lambda c: -(c.importance or 3)),
        "relations": relations,
        "concept_name_map": concept_name_map,
        "flashcards": flashcards,
        "include_images": include_images,
        "include_explanations": include_explanations,
        "include_key_terms": include_key_terms,
        "include_knowledge_map": include_knowledge_map,
        "include_flashcards": include_flashcards,
        "storage_dir": storage_dir,
    }


def render_notes_html(
    *,
    data: dict,
    style: str = "modern-minimal",
    study_summary: str = "",
    base_url: str = "",
) -> str:
    """Render the study notes as a styled HTML string."""
    if style not in VALID_STYLES:
        style = "modern-minimal"

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=True,
    )
    template = env.get_template("study_notes.html")

    # Load CSS
    css_path = TEMPLATE_DIR / "styles" / f"{style}.css"
    style_css = css_path.read_text(encoding="utf-8") if css_path.exists() else ""

    return template.render(
        **data,
        style_css=style_css,
        style_id=style,
        study_summary=study_summary,
        base_url=base_url,
    )


def render_notes_pdf(*, html: str, base_url: str = "") -> bytes:
    """Convert rendered HTML to PDF bytes using WeasyPrint."""
    from weasyprint import HTML as WeasyprintHTML

    return WeasyprintHTML(string=html, base_url=base_url).write_pdf()
```

- [ ] **Step 2: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add backend/app/services/notes_renderer.py
git commit -m "feat: add notes renderer service with data gathering, LLM summary, and HTML/PDF rendering"
```

---

### Task 4: Create the Jinja2 HTML template

**Files:**
- Create: `backend/app/templates/study_notes.html`

- [ ] **Step 1: Create templates directory**

```bash
mkdir -p /Users/shihaochen/github/Teaching-Learning-/backend/app/templates/styles
```

- [ ] **Step 2: Create the HTML template**

Create `backend/app/templates/study_notes.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ title }} — 学习笔记</title>
  <style>
    /* ── Reset & Base ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    @page {
      size: A4;
      margin: 2cm 1.8cm;
    }

    body {
      font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 14px;
      line-height: 1.8;
      color: #333;
      background: #fff;
    }

    /* ── Theme CSS injected here ── */
    {{ style_css | safe }}
  </style>
</head>
<body class="theme-{{ style_id }}">

  <!-- ══ Cover ══ -->
  <section class="cover">
    <div class="cover-inner">
      <h1 class="cover-title">{{ title }}</h1>
      <p class="cover-subtitle">学习笔记</p>
      <div class="cover-meta">
        <span>{{ export_date }}</span>
        <span>{{ total_slides }} 页</span>
        <span>{{ total_concepts }} 个概念</span>
      </div>
    </div>
  </section>

  <!-- ══ Study Summary ══ -->
  {% if study_summary %}
  <section class="summary-section">
    <h2 class="section-heading">学习总结</h2>
    <div class="summary-box">
      {{ study_summary }}
    </div>
  </section>
  {% endif %}

  <!-- ══ Table of Contents ══ -->
  <section class="toc-section">
    <h2 class="section-heading">目录</h2>
    <ol class="toc-list">
      {% for slide in slides %}
      {% if slide.has_content %}
      <li>
        <a href="#slide-{{ slide.page_num }}">{{ slide.title }}</a>
        <span class="toc-page">P{{ slide.page_num }}</span>
      </li>
      {% endif %}
      {% endfor %}
      {% if include_knowledge_map and concepts %}
      <li><a href="#knowledge-map">知识概念地图</a></li>
      {% endif %}
      {% if include_flashcards and flashcards %}
      <li><a href="#flashcards">闪卡复习</a></li>
      {% endif %}
    </ol>
  </section>

  <!-- ══ Per-Slide Content ══ -->
  {% for slide in slides %}
  {% if slide.has_content %}
  <section class="slide-section" id="slide-{{ slide.page_num }}">
    <div class="slide-header">
      <span class="slide-badge">P{{ slide.page_num }}</span>
      <h2 class="slide-title">{{ slide.title }}</h2>
    </div>

    {% if include_images and slide.image_url %}
    <div class="slide-image-wrap">
      <img src="{{ base_url }}{{ slide.image_url }}" alt="Slide {{ slide.page_num }}" class="slide-image" />
    </div>
    {% endif %}

    {% if slide.key_points %}
    <div class="key-points">
      <h3 class="subsection-heading">要点</h3>
      <ul>
        {% for point in slide.key_points %}
        <li>{{ point }}</li>
        {% endfor %}
      </ul>
    </div>
    {% endif %}

    {% if include_explanations and slide.explanation_md %}
    <div class="explanation">
      <h3 class="subsection-heading">详细解析</h3>
      <div class="explanation-content">{{ slide.explanation_md }}</div>
    </div>
    {% endif %}

    {% if include_key_terms and slide.key_terms %}
    <div class="key-terms">
      <h3 class="subsection-heading">关键术语</h3>
      <div class="terms-grid">
        {% for term in slide.key_terms %}
        <div class="term-card">
          <span class="term-name">{{ term.get("text", term.get("name", "")) }}</span>
          {% if term.get("description") %}
          <span class="term-desc">{{ term.description }}</span>
          {% endif %}
        </div>
        {% endfor %}
      </div>
    </div>
    {% endif %}

    {% if slide.formulas %}
    <div class="formulas">
      <h3 class="subsection-heading">公式</h3>
      {% for f in slide.formulas %}
      <div class="formula-box">{{ f.get("text", f.get("latex", "")) }}</div>
      {% endfor %}
    </div>
    {% endif %}
  </section>
  {% endif %}
  {% endfor %}

  <!-- ══ Knowledge Map ══ -->
  {% if include_knowledge_map and concepts %}
  <section class="knowledge-section" id="knowledge-map">
    <h2 class="section-heading">知识概念地图</h2>
    {% for importance_level in [5, 4, 3, 2, 1] %}
      {% set level_concepts = [] %}
      {% for c in concepts %}
        {% if (c.importance or 3) == importance_level %}
          {% if level_concepts.append(c) %}{% endif %}
        {% endif %}
      {% endfor %}
      {% if level_concepts %}
      <div class="importance-group">
        <h3 class="importance-label">
          {{ "★" * importance_level }}{{ "☆" * (5 - importance_level) }}
          <span>重要度 {{ importance_level }}</span>
        </h3>
        <div class="concept-list">
          {% for c in level_concepts %}
          <div class="concept-card">
            <div class="concept-name">{{ c.name }}</div>
            <div class="concept-desc">{{ c.description }}</div>
            {% set related = [] %}
            {% for r in relations %}
              {% if r.source_id == c.id %}
                {% if related.append(concept_name_map.get(r.target_id, "?") ~ " (" ~ r.relation_type ~ ")") %}{% endif %}
              {% elif r.target_id == c.id %}
                {% if related.append(concept_name_map.get(r.source_id, "?") ~ " (" ~ r.relation_type ~ ")") %}{% endif %}
              {% endif %}
            {% endfor %}
            {% if related %}
            <div class="concept-relations">关联: {{ related | join("、") }}</div>
            {% endif %}
          </div>
          {% endfor %}
        </div>
      </div>
      {% endif %}
    {% endfor %}
  </section>
  {% endif %}

  <!-- ══ Flashcards ══ -->
  {% if include_flashcards and flashcards %}
  <section class="flashcard-section" id="flashcards">
    <h2 class="section-heading">闪卡复习</h2>
    <div class="flashcard-grid">
      {% for fc in flashcards %}
      <div class="flashcard">
        <div class="fc-front">
          <span class="fc-label">Q</span>
          {{ fc.front_md }}
        </div>
        <div class="fc-back">
          <span class="fc-label">A</span>
          {{ fc.back_md }}
        </div>
      </div>
      {% endfor %}
    </div>
  </section>
  {% endif %}

  <footer class="notes-footer">
    <p>由 Learning Studio 自动生成 · {{ export_date }}</p>
  </footer>

</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add backend/app/templates/study_notes.html
git commit -m "feat: add Jinja2 HTML template for study notes export"
```

---

### Task 5: Create 3 CSS theme files

**Files:**
- Create: `backend/app/templates/styles/clean-academic.css`
- Create: `backend/app/templates/styles/modern-minimal.css`
- Create: `backend/app/templates/styles/warm-notebook.css`

- [ ] **Step 1: Create clean-academic.css**

Create `backend/app/templates/styles/clean-academic.css`:

```css
/* ── Clean Academic: Textbook feel, serif headings, blue accent ── */

body { font-family: "Noto Serif SC", "Songti SC", "SimSun", serif; color: #1a202c; background: #fff; }

.cover { text-align: center; padding: 80px 40px; border-bottom: 3px double #1a365d; margin-bottom: 40px; page-break-after: always; }
.cover-title { font-size: 32px; font-weight: 700; color: #1a365d; letter-spacing: 0.05em; }
.cover-subtitle { font-size: 16px; color: #4a5568; margin-top: 8px; letter-spacing: 0.2em; text-transform: uppercase; }
.cover-meta { margin-top: 24px; font-size: 13px; color: #718096; display: flex; justify-content: center; gap: 24px; }

.section-heading { font-size: 22px; font-weight: 700; color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 6px; margin: 32px 0 16px; }
.subsection-heading { font-size: 15px; font-weight: 600; color: #2d3748; margin: 16px 0 8px; }

.summary-section { margin-bottom: 32px; }
.summary-box { background: #f7fafc; border-left: 4px solid #2b6cb0; padding: 16px 20px; font-size: 14px; line-height: 1.9; color: #2d3748; }

.toc-section { margin-bottom: 40px; page-break-after: always; }
.toc-list { list-style: decimal; padding-left: 24px; }
.toc-list li { padding: 4px 0; font-size: 14px; display: flex; justify-content: space-between; }
.toc-list a { color: #1a365d; text-decoration: none; }
.toc-page { color: #a0aec0; font-size: 12px; }

.slide-section { margin-bottom: 36px; page-break-inside: avoid; }
.slide-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.slide-badge { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: #1a365d; color: #fff; font-size: 13px; font-weight: 700; flex-shrink: 0; }
.slide-title { font-size: 18px; font-weight: 700; color: #1a365d; }
.slide-image-wrap { margin: 12px 0; text-align: center; }
.slide-image { max-width: 65%; border: 1px solid #e2e8f0; border-radius: 4px; }

.key-points ul { padding-left: 20px; }
.key-points li { margin: 4px 0; font-size: 14px; }
.explanation-content { font-size: 14px; line-height: 1.9; color: #2d3748; white-space: pre-wrap; }

.terms-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.term-card { background: #f7fafc; border: 1px solid #e2e8f0; padding: 8px 12px; border-radius: 4px; font-size: 13px; }
.term-name { font-weight: 600; color: #1a365d; }
.term-desc { color: #718096; margin-left: 8px; }

.formula-box { background: #f7fafc; border: 1px solid #e2e8f0; padding: 12px 16px; margin: 8px 0; font-family: "Courier New", monospace; font-size: 14px; text-align: center; border-radius: 4px; }

.knowledge-section { page-break-before: always; }
.importance-group { margin-bottom: 24px; }
.importance-label { font-size: 14px; color: #d69e2e; margin-bottom: 8px; }
.importance-label span { color: #718096; font-size: 12px; margin-left: 8px; }
.concept-list { display: flex; flex-direction: column; gap: 8px; }
.concept-card { background: #f7fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 4px; }
.concept-name { font-weight: 700; color: #1a365d; font-size: 15px; }
.concept-desc { font-size: 13px; color: #4a5568; margin-top: 4px; }
.concept-relations { font-size: 12px; color: #a0aec0; margin-top: 4px; }

.flashcard-section { page-break-before: always; }
.flashcard-grid { display: flex; flex-direction: column; gap: 12px; }
.flashcard { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; page-break-inside: avoid; }
.fc-front { background: #f7fafc; padding: 12px 16px; font-size: 14px; font-weight: 500; border-bottom: 1px solid #e2e8f0; }
.fc-back { padding: 12px 16px; font-size: 13px; color: #4a5568; }
.fc-label { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 11px; font-weight: 700; margin-right: 8px; }
.fc-front .fc-label { background: #2b6cb0; color: #fff; }
.fc-back .fc-label { background: #e2e8f0; color: #4a5568; }

.notes-footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #a0aec0; }
```

- [ ] **Step 2: Create modern-minimal.css**

Create `backend/app/templates/styles/modern-minimal.css`:

```css
/* ── Modern Minimal: Sans-serif, teal accent, card-based ── */

body { font-family: "Inter", "Noto Sans SC", "PingFang SC", sans-serif; color: #2d3748; background: #fff; }

.cover { text-align: center; padding: 80px 40px; background: linear-gradient(135deg, #f0fdfa 0%, #e6fffa 50%, #f0fff4 100%); border-radius: 16px; margin-bottom: 40px; page-break-after: always; }
.cover-title { font-size: 36px; font-weight: 800; color: #234e52; letter-spacing: -0.02em; }
.cover-subtitle { font-size: 15px; color: #4fd1c5; margin-top: 8px; font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; }
.cover-meta { margin-top: 28px; font-size: 13px; color: #718096; display: flex; justify-content: center; gap: 20px; }
.cover-meta span { background: #fff; padding: 4px 14px; border-radius: 20px; border: 1px solid #e2e8f0; }

.section-heading { font-size: 20px; font-weight: 700; color: #234e52; margin: 36px 0 16px; padding-left: 12px; border-left: 4px solid #319795; }
.subsection-heading { font-size: 14px; font-weight: 600; color: #319795; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.05em; }

.summary-section { margin-bottom: 36px; }
.summary-box { background: #f0fdfa; border: 1px solid #b2f5ea; border-radius: 12px; padding: 20px 24px; font-size: 14px; line-height: 1.9; color: #234e52; }

.toc-section { margin-bottom: 40px; page-break-after: always; }
.toc-list { list-style: none; padding: 0; }
.toc-list li { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-radius: 10px; margin: 4px 0; }
.toc-list li:nth-child(odd) { background: #f7fafc; }
.toc-list a { color: #2d3748; text-decoration: none; font-weight: 500; font-size: 14px; }
.toc-page { background: #e6fffa; color: #319795; font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 12px; }

.slide-section { margin-bottom: 32px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); page-break-inside: avoid; }
.slide-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.slide-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 28px; border-radius: 14px; background: linear-gradient(135deg, #319795, #38b2ac); color: #fff; font-size: 12px; font-weight: 700; padding: 0 10px; }
.slide-title { font-size: 17px; font-weight: 700; color: #1a202c; }
.slide-image-wrap { margin: 16px 0; text-align: center; }
.slide-image { max-width: 60%; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }

.key-points { background: #f7fafc; border-radius: 10px; padding: 14px 18px; margin: 12px 0; }
.key-points ul { padding-left: 18px; }
.key-points li { margin: 4px 0; font-size: 13px; color: #4a5568; }
.explanation-content { font-size: 14px; line-height: 1.85; color: #2d3748; margin: 12px 0; white-space: pre-wrap; }

.terms-grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.term-card { background: #e6fffa; border: 1px solid #b2f5ea; padding: 6px 14px; border-radius: 20px; font-size: 13px; }
.term-name { font-weight: 600; color: #234e52; }
.term-desc { color: #4a5568; margin-left: 6px; }

.formula-box { background: #1a202c; color: #e2e8f0; padding: 14px 20px; margin: 8px 0; font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 14px; text-align: center; border-radius: 10px; }

.knowledge-section { page-break-before: always; }
.importance-group { margin-bottom: 24px; }
.importance-label { font-size: 14px; color: #d69e2e; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.importance-label span { color: #a0aec0; font-size: 12px; }
.concept-list { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.concept-card { background: #f7fafc; border: 1px solid #e2e8f0; padding: 14px 16px; border-radius: 12px; }
.concept-name { font-weight: 700; color: #234e52; font-size: 14px; }
.concept-desc { font-size: 12px; color: #4a5568; margin-top: 4px; line-height: 1.6; }
.concept-relations { font-size: 11px; color: #a0aec0; margin-top: 6px; }

.flashcard-section { page-break-before: always; }
.flashcard-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
.flashcard { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; page-break-inside: avoid; }
.fc-front { background: #f0fdfa; padding: 14px 18px; font-size: 14px; font-weight: 500; color: #234e52; }
.fc-back { padding: 14px 18px; font-size: 13px; color: #4a5568; background: #fff; }
.fc-label { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 11px; font-weight: 700; margin-right: 8px; }
.fc-front .fc-label { background: #319795; color: #fff; }
.fc-back .fc-label { background: #e2e8f0; color: #4a5568; }

.notes-footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #a0aec0; }
```

- [ ] **Step 3: Create warm-notebook.css**

Create `backend/app/templates/styles/warm-notebook.css`:

```css
/* ── Warm Notebook: Handwritten feel, brown/orange accent, cream bg ── */

body { font-family: "LXGW WenKai", "Noto Sans SC", "PingFang SC", sans-serif; color: #4a3728; background: #fffbf0; }

.cover { text-align: center; padding: 80px 40px; background: linear-gradient(160deg, #fffbf0 0%, #fef3e2 50%, #fff8ee 100%); border: 2px dashed #d4a76a; border-radius: 20px; margin-bottom: 40px; page-break-after: always; }
.cover-title { font-size: 34px; font-weight: 700; color: #5d4037; letter-spacing: 0.03em; }
.cover-subtitle { font-size: 15px; color: #e65100; margin-top: 10px; font-weight: 500; }
.cover-meta { margin-top: 28px; font-size: 13px; color: #a1887f; display: flex; justify-content: center; gap: 16px; }
.cover-meta span { background: #fff; padding: 4px 14px; border-radius: 16px; border: 1px dashed #d7ccc8; }

.section-heading { font-size: 22px; font-weight: 700; color: #5d4037; margin: 36px 0 14px; position: relative; padding-bottom: 8px; }
.section-heading::after { content: ""; position: absolute; bottom: 0; left: 0; width: 60px; height: 3px; background: linear-gradient(90deg, #e65100, #ff8a65); border-radius: 2px; }
.subsection-heading { font-size: 14px; font-weight: 600; color: #bf360c; margin: 14px 0 6px; }

.summary-section { margin-bottom: 36px; }
.summary-box { background: #fff3e0; border: 1px solid #ffe0b2; border-radius: 16px; padding: 20px 24px; font-size: 14px; line-height: 2; color: #5d4037; position: relative; }
.summary-box::before { content: "📝"; position: absolute; top: -12px; left: 20px; font-size: 22px; background: #fffbf0; padding: 0 6px; }

.toc-section { margin-bottom: 40px; page-break-after: always; }
.toc-list { list-style: none; padding: 0; counter-reset: toc; }
.toc-list li { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px dotted #d7ccc8; counter-increment: toc; }
.toc-list li::before { content: counter(toc) ". "; color: #e65100; font-weight: 600; margin-right: 4px; }
.toc-list a { color: #5d4037; text-decoration: none; font-size: 14px; }
.toc-page { color: #bcaaa4; font-size: 12px; }

.slide-section { margin-bottom: 32px; background: #fff; border: 1px solid #efebe9; border-radius: 18px; padding: 24px; position: relative; page-break-inside: avoid; }
.slide-section::before { content: ""; position: absolute; top: 12px; left: 12px; right: 12px; bottom: 12px; border: 1px dashed #f5e6d3; border-radius: 12px; pointer-events: none; }
.slide-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; position: relative; z-index: 1; }
.slide-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 30px; border-radius: 15px; background: linear-gradient(135deg, #e65100, #ff6d00); color: #fff; font-size: 12px; font-weight: 700; padding: 0 12px; box-shadow: 0 2px 6px rgba(230,81,0,0.25); }
.slide-title { font-size: 17px; font-weight: 700; color: #4e342e; }
.slide-image-wrap { margin: 16px 0; text-align: center; position: relative; z-index: 1; }
.slide-image { max-width: 60%; border-radius: 14px; border: 2px solid #efebe9; box-shadow: 0 4px 16px rgba(93,64,55,0.08); }

.key-points { background: #fff8e1; border-radius: 12px; padding: 14px 18px; margin: 12px 0; position: relative; z-index: 1; }
.key-points ul { padding-left: 18px; list-style-type: "✦ "; }
.key-points li { margin: 5px 0; font-size: 13px; color: #5d4037; }
.explanation-content { font-size: 14px; line-height: 2; color: #4a3728; margin: 12px 0; position: relative; z-index: 1; white-space: pre-wrap; }

.terms-grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; position: relative; z-index: 1; }
.term-card { background: #fff3e0; border: 1px solid #ffe0b2; padding: 6px 14px; border-radius: 16px; font-size: 13px; }
.term-name { font-weight: 600; color: #bf360c; }
.term-desc { color: #6d4c41; margin-left: 6px; }

.formula-box { background: #5d4037; color: #ffe0b2; padding: 14px 20px; margin: 8px 0; font-family: "JetBrains Mono", monospace; font-size: 14px; text-align: center; border-radius: 12px; position: relative; z-index: 1; }

.knowledge-section { page-break-before: always; }
.importance-group { margin-bottom: 24px; }
.importance-label { font-size: 15px; color: #e65100; margin-bottom: 10px; }
.importance-label span { color: #bcaaa4; font-size: 12px; margin-left: 8px; }
.concept-list { display: flex; flex-direction: column; gap: 10px; }
.concept-card { background: #fff; border: 1px solid #efebe9; padding: 14px 18px; border-radius: 14px; border-left: 4px solid #ff8a65; }
.concept-name { font-weight: 700; color: #4e342e; font-size: 15px; }
.concept-desc { font-size: 13px; color: #6d4c41; margin-top: 4px; line-height: 1.7; }
.concept-relations { font-size: 11px; color: #bcaaa4; margin-top: 6px; }

.flashcard-section { page-break-before: always; }
.flashcard-grid { display: flex; flex-direction: column; gap: 14px; }
.flashcard { border: 1px solid #efebe9; border-radius: 14px; overflow: hidden; page-break-inside: avoid; box-shadow: 0 2px 8px rgba(93,64,55,0.06); }
.fc-front { background: #fff3e0; padding: 14px 18px; font-size: 14px; font-weight: 500; color: #4e342e; }
.fc-back { padding: 14px 18px; font-size: 13px; color: #6d4c41; background: #fff; }
.fc-label { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 11px; font-weight: 700; margin-right: 8px; }
.fc-front .fc-label { background: #e65100; color: #fff; }
.fc-back .fc-label { background: #efebe9; color: #6d4c41; }

.notes-footer { margin-top: 48px; padding-top: 16px; border-top: 1px dashed #d7ccc8; text-align: center; font-size: 11px; color: #bcaaa4; }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add backend/app/templates/
git commit -m "feat: add 3 CSS themes for study notes export (academic, minimal, warm)"
```

---

## Chunk 2: Backend API Router + Frontend

### Task 6: Create the export API router

**Files:**
- Create: `backend/app/api/export_notes.py`
- Modify: `backend/app/main.py` (register router)

- [ ] **Step 1: Create the export_notes router**

Create `backend/app/api/export_notes.py`:

```python
"""API endpoints for exporting styled study notes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlmodel import Session

from app.api.deps import get_db_session
from app.schemas import (
    ExportNotesPreviewResponse,
    ExportNotesRequest,
    ExportNotesStyle,
    ExportNotesStylesResponse,
)
from app.services.notes_renderer import (
    STYLE_META,
    VALID_STYLES,
    _generate_study_summary,
    gather_export_data,
    render_notes_html,
    render_notes_pdf,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/export-notes", tags=["export-notes"])


@router.get("/styles", response_model=ExportNotesStylesResponse)
def list_styles():
    """Return available note export styles."""
    return ExportNotesStylesResponse(
        styles=[ExportNotesStyle(**s) for s in STYLE_META]
    )


@router.post("/{document_id}/preview", response_model=ExportNotesPreviewResponse)
def preview_notes(
    document_id: str,
    body: ExportNotesRequest,
    request: Request,
    db: Session = Depends(get_db_session),
):
    """Generate HTML preview of the styled notes."""
    storage_dir = str(getattr(request.app.state, "storage_dir", "./storage"))
    base_url = str(request.base_url).rstrip("/")

    data = gather_export_data(
        db=db,
        document_id=document_id,
        include_images=body.include_images,
        include_explanations=body.include_explanations,
        include_key_terms=body.include_key_terms,
        include_knowledge_map=body.include_knowledge_map,
        include_flashcards=body.include_flashcards,
        storage_dir=storage_dir,
    )

    # Generate study summary via LLM (non-blocking on failure)
    summary = _generate_study_summary(
        title=data["title"],
        slides_data=data["slides"],
        concepts=data["concepts"],
        relations=data["relations"],
    )

    html = render_notes_html(
        data=data,
        style=body.style,
        study_summary=summary,
        base_url=base_url,
    )

    return ExportNotesPreviewResponse(
        html=html,
        title=data["title"],
        page_count=data["total_slides"],
        concept_count=data["total_concepts"],
    )


@router.post("/{document_id}/download")
def download_notes(
    document_id: str,
    body: ExportNotesRequest,
    request: Request,
    db: Session = Depends(get_db_session),
):
    """Generate and download the styled notes as PDF or HTML file."""
    storage_dir = str(getattr(request.app.state, "storage_dir", "./storage"))
    base_url = str(request.base_url).rstrip("/")

    data = gather_export_data(
        db=db,
        document_id=document_id,
        include_images=body.include_images,
        include_explanations=body.include_explanations,
        include_key_terms=body.include_key_terms,
        include_knowledge_map=body.include_knowledge_map,
        include_flashcards=body.include_flashcards,
        storage_dir=storage_dir,
    )

    summary = _generate_study_summary(
        title=data["title"],
        slides_data=data["slides"],
        concepts=data["concepts"],
        relations=data["relations"],
    )

    html = render_notes_html(
        data=data,
        style=body.style,
        study_summary=summary,
        base_url=base_url,
    )

    title = data["title"]

    if body.format == "pdf":
        pdf_bytes = render_notes_pdf(html=html, base_url=base_url)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{title}-notes.pdf"'
            },
        )
    else:
        return Response(
            content=html.encode("utf-8"),
            media_type="text/html; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{title}-notes.html"'
            },
        )
```

- [ ] **Step 2: Register router in main.py**

In `backend/app/main.py`, find the router include section and add:

```python
from app.api.export_notes import router as export_notes_router
app.include_router(export_notes_router)
```

- [ ] **Step 3: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add backend/app/api/export_notes.py backend/app/main.py
git commit -m "feat: add export-notes API router with preview and download endpoints"
```

---

### Task 7: Add frontend API functions

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add export notes types and API functions**

Append to `frontend/lib/api.ts`:

```typescript
// ── Export Styled Notes ───────────────────────────────────────

export type ExportNotesStyle = {
  id: string;
  name: string;
  name_zh: string;
  description: string;
  color_primary: string;
  color_accent: string;
};

export type ExportNotesRequest = {
  style: string;
  format: "html" | "pdf";
  include_images: boolean;
  include_explanations: boolean;
  include_key_terms: boolean;
  include_knowledge_map: boolean;
  include_flashcards: boolean;
};

export async function fetchExportStyles(): Promise<ExportNotesStyle[]> {
  const data = await request<{ styles: ExportNotesStyle[] }>(
    "/api/v1/export-notes/styles",
  );
  return data.styles;
}

export async function previewExportNotes(
  documentId: string,
  options: ExportNotesRequest,
): Promise<{ html: string; title: string; page_count: number; concept_count: number }> {
  return request<{ html: string; title: string; page_count: number; concept_count: number }>(
    `/api/v1/export-notes/${documentId}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    },
    { timeoutMs: 120_000 },
  );
}

export async function downloadExportNotes(
  documentId: string,
  options: ExportNotesRequest,
): Promise<void> {
  const baseUrl = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? window.location.origin)
    : "";
  const token = getToken();
  const res = await fetch(`${baseUrl}/api/v1/export-notes/${documentId}/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new ServerError(res.status, await res.text());
  const blob = await res.blob();
  const ext = options.format === "pdf" ? "pdf" : "html";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `study-notes.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add frontend/lib/api.ts
git commit -m "feat: add export notes API functions (preview + download)"
```

---

### Task 8: Create the ExportNotesModal component

**Files:**
- Create: `frontend/components/export-notes-modal.tsx`

- [ ] **Step 1: Create the modal component**

Create `frontend/components/export-notes-modal.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import {
  downloadExportNotes,
  fetchExportStyles,
  previewExportNotes,
  type ExportNotesRequest,
  type ExportNotesStyle,
} from "@/lib/api";

type ExportNotesModalProps = {
  documentId: string;
  documentName?: string;
  open: boolean;
  onClose: () => void;
};

type Phase = "config" | "generating" | "preview" | "downloading" | "error";

const DEFAULT_OPTIONS: ExportNotesRequest = {
  style: "modern-minimal",
  format: "pdf",
  include_images: true,
  include_explanations: true,
  include_key_terms: true,
  include_knowledge_map: true,
  include_flashcards: true,
};

const CONTENT_TOGGLES = [
  { key: "include_images" as const, label: "幻灯片图片" },
  { key: "include_explanations" as const, label: "详细解析" },
  { key: "include_key_terms" as const, label: "关键术语" },
  { key: "include_knowledge_map" as const, label: "知识概念地图" },
  { key: "include_flashcards" as const, label: "闪卡复习" },
];

export function ExportNotesModal({
  documentId,
  documentName,
  open,
  onClose,
}: ExportNotesModalProps) {
  const [styles, setStyles] = useState<ExportNotesStyle[]>([]);
  const [options, setOptions] = useState<ExportNotesRequest>({ ...DEFAULT_OPTIONS });
  const [phase, setPhase] = useState<Phase>("config");
  const [previewHtml, setPreviewHtml] = useState("");
  const [error, setError] = useState("");

  // Load styles on mount
  useEffect(() => {
    fetchExportStyles()
      .then(setStyles)
      .catch(() => {});
  }, []);

  // Reset when opened
  useEffect(() => {
    if (open) {
      setPhase("config");
      setPreviewHtml("");
      setError("");
    }
  }, [open]);

  const handleGenerate = useCallback(async () => {
    setPhase("generating");
    setError("");
    try {
      const result = await previewExportNotes(documentId, {
        ...options,
        format: "html",
      });
      setPreviewHtml(result.html);
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setPhase("error");
    }
  }, [documentId, options]);

  const handleDownload = useCallback(async (format: "pdf" | "html") => {
    setPhase("downloading");
    try {
      await downloadExportNotes(documentId, { ...options, format });
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
      setPhase("error");
    }
  }, [documentId, options]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative flex h-[85vh] w-[min(900px,92vw)] flex-col rounded-[24px] border border-[var(--bd-1)] bg-[var(--sf-1)] shadow-[var(--sh-panel)]">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--bd-2)] px-6 py-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--tx-1)]">导出学习笔记</h2>
            {documentName && (
              <p className="mt-0.5 text-[13px] text-[var(--tx-5)] truncate max-w-[400px]">
                {documentName}
              </p>
            )}
          </div>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--bd-2)] text-[var(--tx-5)] transition-colors hover:bg-[var(--sf-4)] hover:text-[var(--tx-3)]"
            onClick={onClose}
            type="button"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {phase === "config" || phase === "error" ? (
            <div className="flex flex-col gap-6">
              {/* Style Picker */}
              <div>
                <h3 className="mb-3 text-[14px] font-semibold text-[var(--tx-2)]">选择风格</h3>
                <div className="grid grid-cols-3 gap-3">
                  {styles.map((s) => (
                    <button
                      key={s.id}
                      className={`rounded-2xl border-2 p-4 text-left transition-all ${
                        options.style === s.id
                          ? "border-[var(--brand-sage)] bg-[var(--ac-green-bg)] shadow-sm"
                          : "border-[var(--bd-2)] bg-[var(--sf-2)] hover:border-[var(--bd-4)]"
                      }`}
                      onClick={() => setOptions((prev) => ({ ...prev, style: s.id }))}
                      type="button"
                    >
                      {/* Color swatch */}
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className="inline-block h-4 w-4 rounded-full"
                          style={{ background: s.color_primary }}
                        />
                        <span
                          className="inline-block h-4 w-4 rounded-full"
                          style={{ background: s.color_accent }}
                        />
                      </div>
                      <p className="text-[14px] font-semibold text-[var(--tx-1)]">{s.name_zh}</p>
                      <p className="mt-1 text-[12px] text-[var(--tx-5)] leading-relaxed">{s.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Content Toggles */}
              <div>
                <h3 className="mb-3 text-[14px] font-semibold text-[var(--tx-2)]">包含内容</h3>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TOGGLES.map((t) => {
                    const checked = options[t.key];
                    return (
                      <button
                        key={t.key}
                        className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                          checked
                            ? "border-[var(--brand-sage)] bg-[var(--ac-green-bg)] text-[var(--ac-green-text)]"
                            : "border-[var(--bd-2)] bg-[var(--sf-2)] text-[var(--tx-5)]"
                        }`}
                        onClick={() =>
                          setOptions((prev) => ({ ...prev, [t.key]: !prev[t.key] }))
                        }
                        type="button"
                      >
                        {checked ? "✓ " : ""}{t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl border border-[var(--ac-red-border)] bg-[var(--ac-red-bg)] px-4 py-3 text-[13px] text-[var(--ac-red-text)]">
                  {error}
                </div>
              )}
            </div>
          ) : phase === "generating" || phase === "downloading" ? (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <svg className="h-8 w-8 animate-spin text-[var(--brand-sage)]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-[15px] font-medium text-[var(--tx-2)]">
                {phase === "generating" ? "正在生成学习笔记..." : "正在准备下载..."}
              </p>
              <p className="text-[13px] text-[var(--tx-5)]">
                {phase === "generating" ? "AI 正在生成学习总结，约需 10-20 秒" : "正在转换为文件"}
              </p>
            </div>
          ) : phase === "preview" ? (
            <div className="h-full">
              <iframe
                className="h-full w-full rounded-2xl border border-[var(--bd-2)]"
                srcDoc={previewHtml}
                title="笔记预览"
                sandbox="allow-same-origin"
              />
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-[var(--bd-2)] px-6 py-4">
          <div className="text-[12px] text-[var(--tx-6)]">
            {phase === "preview" ? "预览满意后下载" : "选择风格和内容后生成预览"}
          </div>
          <div className="flex items-center gap-2">
            {(phase === "config" || phase === "error") && (
              <button
                className="btn btn-primary !px-5 !py-2 !text-[14px]"
                onClick={handleGenerate}
                type="button"
              >
                生成预览
              </button>
            )}
            {phase === "preview" && (
              <>
                <button
                  className="rounded-xl border border-[var(--bd-2)] bg-[var(--sf-4)] px-4 py-2 text-[13px] font-medium text-[var(--tx-4)] transition-colors hover:bg-[var(--sf-5)]"
                  onClick={() => setPhase("config")}
                  type="button"
                >
                  返回修改
                </button>
                <button
                  className="rounded-xl border border-[var(--bd-2)] bg-[var(--sf-4)] px-4 py-2 text-[13px] font-medium text-[var(--tx-4)] transition-colors hover:bg-[var(--sf-5)]"
                  onClick={() => handleDownload("html")}
                  type="button"
                >
                  下载 HTML
                </button>
                <button
                  className="btn btn-primary !px-5 !py-2 !text-[14px]"
                  onClick={() => handleDownload("pdf")}
                  type="button"
                >
                  下载 PDF
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add frontend/components/export-notes-modal.tsx
git commit -m "feat: add ExportNotesModal component with style picker, content toggles, preview, and download"
```

---

### Task 9: Wire up page.tsx — remove notebook, add export modal

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Replace notebook imports with export modal import**

In `page.tsx`, remove these imports:
```typescript
import { NotebookWindow } from "@/components/notebook-window";
```

And the following from the `api` import block: `autogenNotebook`, `exportNotebook`, `fetchNotebook`, `saveNotebook`, `exportDocumentExplanations`

Add:
```typescript
import { ExportNotesModal } from "@/components/export-notes-modal";
```

- [ ] **Step 2: Remove notebook state variables**

Remove these state declarations:
- `notesMarkdown`, `setNotesMarkdown`
- `notebookBusy`, `setNotebookBusy`
- `notebookSaving`, `setNotebookSaving`
- `notebookSaveState`, `setNotebookSaveState`
- `notebookViewMode`, `setNotebookViewMode`
- `notePanelOpen`, `setNotePanelOpen`
- `notesMarkdownRef`
- `notebookLastSavedRef`
- `notebookDocumentRef`

Replace with:
```typescript
const [exportModalOpen, setExportModalOpen] = useState(false);
```

- [ ] **Step 3: Remove notebook-related functions and effects**

Remove:
- `updateNotesMarkdown` callback
- `persistNotebook` function
- The `useEffect` that loads notebook on document change (around line 176-221)
- The `useEffect` for debounced notebook save (around line 223-231)
- `handleExportNotes` function
- `handleExportAllExplanations` function
- `handleAutoGenerateNotes` function
- `handleAIPolishNotes` function
- `notebookSaveLabel` computation
- `downloadMarkdown` utility function

- [ ] **Step 4: Replace the notebook button in the header**

Find the notebook toggle button (the one with `data-testid="header-notebook-toggle"`) and replace with an export button:

```tsx
<button
  aria-label="导出学习笔记"
  className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-medium transition-colors ${
    upload.documentId
      ? "border-[var(--bd-1)] bg-[var(--sf-1)] text-[var(--tx-3)] hover:bg-[var(--sf-3)]"
      : "cursor-not-allowed border-[var(--bd-2)] bg-[var(--sf-4)] text-[var(--tx-6)]"
  }`}
  disabled={!upload.documentId}
  onClick={() => setExportModalOpen(true)}
  type="button"
>
  <svg
    aria-hidden="true"
    className="h-3.5 w-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
  <span>导出笔记</span>
</button>
```

- [ ] **Step 5: Replace NotebookWindow with ExportNotesModal at the bottom of the JSX**

Remove the `<NotebookWindow ... />` block and replace with:

```tsx
<ExportNotesModal
  documentId={upload.documentId ?? ""}
  documentName={currentDocumentName}
  open={exportModalOpen}
  onClose={() => setExportModalOpen(false)}
/>
```

- [ ] **Step 6: Clean up the `loading` computation and `statusText`**

Remove `notebookBusy` and `notebookSaving` from the `loading` computation. Remove notebook-related status references.

- [ ] **Step 7: Remove notebook-related props from AIPanel call**

In the `<AIPanel>` JSX, remove:
- `onInsertToNotes` prop and its inline handler

- [ ] **Step 8: Verify TypeScript compiles**

Run:
```bash
cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add frontend/app/page.tsx
git commit -m "feat: replace notebook with export notes modal in main page"
```

---

### Task 10: Clean up AIPanel — remove notebook-related props

**Files:**
- Modify: `frontend/components/ai-panel.tsx`

- [ ] **Step 1: Remove `onInsertToNotes` from AIPanelProps type**

Remove `onInsertToNotes: (text: string) => void;` from the props type.

- [ ] **Step 2: Remove references to `onInsertToNotes` in the component**

Remove the `onInsertToNotes` destructure from props and any UI elements that call it (e.g., "加入笔记本" button in explanation section).

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add frontend/components/ai-panel.tsx
git commit -m "refactor: remove notebook-related props from AIPanel"
```

---

### Task 11: Delete old notebook files

**Files:**
- Delete: `frontend/components/notebook-window.tsx`
- Delete: `frontend/components/note-editor.tsx`

- [ ] **Step 1: Delete the files**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
rm frontend/components/notebook-window.tsx frontend/components/note-editor.tsx
```

- [ ] **Step 2: Verify no remaining imports**

Run:
```bash
cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd /Users/shihaochen/github/Teaching-Learning-
git add -u frontend/components/notebook-window.tsx frontend/components/note-editor.tsx
git commit -m "refactor: remove old notebook-window and note-editor components"
```

---

### Task 12: Final build verification

- [ ] **Step 1: Full TypeScript check**

```bash
cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx tsc --noEmit
```

- [ ] **Step 2: Production build**

```bash
cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx next build --no-lint
```

- [ ] **Step 3: Backend import check**

```bash
cd /Users/shihaochen/github/Teaching-Learning-/backend && python -c "from app.api.export_notes import router; print('OK')"
```

All three should pass with no errors.
