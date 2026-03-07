# Extraction And Generation Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add fixed-screen module scrolling, deterministic current-page extraction, full-document and single-page explanation generation controls, and server-only prompt handling.

**Architecture:** Extend the existing FastAPI document pipeline so extraction and explanation become separate concerns: extraction is deterministic and persisted in `SlideExtract`, while explanation remains cached Markdown in `SlideExplanation`. Update the Next.js workspace so the explanation tab shows both extraction and generation state, and add explicit overwrite-style regeneration actions at document and slide scope.

**Tech Stack:** FastAPI, SQLModel, PyMuPDF, pdfplumber, Next.js 15, React 19, Playwright smoke checks, pytest

---

### Task 1: Lock Prompt Handling To The Backend

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/services/explanation_engine.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/services/explanation_cache.py`
- Test: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_cached_explanations_and_notes.py`

**Step 1: Write the failing test**

```python
def test_generated_explanation_does_not_embed_prompt_contract(sample_slide):
    markdown, _ = generate_slide_explanation(
        slide=sample_slide,
        question="总结本页",
        extracted_text="Gradient descent updates parameters.",
    )
    assert "Prompt Contract" not in markdown
    assert "<!--" not in markdown
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_cached_explanations_and_notes.py -k prompt`

Expected: FAIL because the current Markdown still includes the embedded prompt comment.

**Step 3: Write minimal implementation**

```python
def generate_slide_explanation(...):
    _prompt_contract = build_slide_explanation_prompt(...)
    return answer_without_prompt_comment, follow_ups
```

Also ensure any cache helpers write only user-visible Markdown.

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_cached_explanations_and_notes.py -k prompt`

Expected: PASS

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/services/explanation_engine.py backend/app/services/explanation_cache.py backend/tests/test_cached_explanations_and_notes.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "fix: keep explanation prompts server-side"
```

### Task 2: Enrich Slide Extraction Without LLM

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/services/slide_processor.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/schemas.py`
- Test: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_documents_api.py`

**Step 1: Write the failing test**

```python
def test_pdf_slide_extract_contains_structured_blocks(client, uploaded_pdf_document):
    response = client.get(f"/api/v1/documents/{uploaded_pdf_document}/slides")
    assert response.status_code == 200
    payload = response.json()
    first_slide = payload["slides"][0]
    assert "extract" in first_slide
    assert "text_blocks" in first_slide["extract"]
    assert "figures" in first_slide["extract"]
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_documents_api.py -k structured_blocks`

Expected: FAIL because slide responses do not expose structured extraction yet.

**Step 3: Write minimal implementation**

```python
page_dict = page.get_text("dict")
text_blocks = [...]
figure_blocks = [...]
payload = {
    "title_candidates": [...],
    "text_blocks": text_blocks,
    "figures": figure_blocks,
    "tables": [],
    "page_stats": {...},
}
```

Use `PyMuPDF` first and add `pdfplumber` table detection only where cheap and reliable.

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_documents_api.py -k structured_blocks`

Expected: PASS

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/services/slide_processor.py backend/app/schemas.py backend/tests/test_documents_api.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add structured slide extraction"
```

### Task 3: Add Explanation Regeneration Endpoints

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/api/documents.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/services/explanation_cache.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/schemas.py`
- Test: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_documents_api.py`

**Step 1: Write the failing test**

```python
def test_regenerate_single_slide_overwrites_cached_markdown(client, ready_document, ready_slide):
    response = client.post(f"/api/v1/documents/{ready_document}/slides/{ready_slide}/explanations/generate")
    assert response.status_code == 200
    payload = response.json()
    assert payload["overwrote_existing"] is True


def test_regenerate_document_overwrites_all_slide_markdown(client, ready_document):
    response = client.post(f"/api/v1/documents/{ready_document}/explanations/generate")
    assert response.status_code == 202
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_documents_api.py -k regenerate`

Expected: FAIL because the routes do not exist.

**Step 3: Write minimal implementation**

```python
@router.post("/{document_id}/explanations/generate")
def regenerate_document_explanations(...):
    enqueue_overwrite_job(document_id)
    return {"status": "accepted"}


@router.post("/{document_id}/slides/{slide_id}/explanations/generate")
def regenerate_slide_explanation(...):
    explanation = overwrite_slide_explanation(...)
    return explanation
```

Document-level regeneration may run inline first if background orchestration is already simple and reliable, but the API contract should still report state clearly.

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_documents_api.py -k regenerate`

Expected: PASS

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/api/documents.py backend/app/services/explanation_cache.py backend/app/schemas.py backend/tests/test_documents_api.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add explanation regeneration endpoints"
```

### Task 4: Surface Extraction And Generation State In The Frontend

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/lib/api.ts`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/app/page.tsx`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/components/ai-panel.tsx`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/components/slide-viewer.tsx`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/app/globals.css`

**Step 1: Write the failing test**

Use the Playwright smoke script as the first red bar by asserting the new buttons and waiting state exist.

```python
expect(page.get_by_role("button", name="整份生成讲解")).to_be_visible()
expect(page.get_by_role("button", name="生成本页讲解")).to_be_visible()
expect(page.get_by_text("等待大模型生成")).to_be_visible()
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning- && python scripts/playwright_smoke.py`

Expected: FAIL because the new buttons and extraction card are not rendered yet.

**Step 3: Write minimal implementation**

```tsx
<section className="flex h-screen overflow-hidden">
  <aside className="min-h-0 overflow-hidden">...</aside>
  <main className="min-h-0 overflow-hidden">...</main>
</section>
```

In `ai-panel.tsx`, split the explanation tab into:
- extraction card
- explanation card with state badge and regenerate button

In `page.tsx`, add document-level regenerate action in the sidebar card.

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning- && python scripts/playwright_smoke.py`

Expected: PASS for the new UI assertions and pre-existing smoke flow.

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add frontend/lib/api.ts frontend/app/page.tsx frontend/components/ai-panel.tsx frontend/components/slide-viewer.tsx frontend/app/globals.css scripts/playwright_smoke.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add extraction panel and generation controls"
```

### Task 5: Preserve Notes And Export Behavior With The New Split

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/components/ai-panel.tsx`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/api/notes.py`
- Test: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_cached_explanations_and_notes.py`
- Test: `/Users/shihaochen/github/Teaching-Learning-/scripts/playwright_smoke.py`

**Step 1: Write the failing test**

```python
def test_notes_append_uses_visible_explanation_text_not_hidden_prompt():
    assert "Prompt Contract" not in rendered_selection_source
```

Add a smoke assertion that notes capture still works after the explanation panel split.

**Step 2: Run test to verify it fails**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_cached_explanations_and_notes.py`

Expected: FAIL if any hidden prompt text leaks into note generation or export fixtures.

**Step 3: Write minimal implementation**

```tsx
const visibleExplanationMarkdown = explanation?.markdown ?? "";
```

Keep selection-based note capture bound only to visible explanation content, and keep export output sourced from persisted clean Markdown.

**Step 4: Run test to verify it passes**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_cached_explanations_and_notes.py`

Expected: PASS

**Step 5: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add frontend/components/ai-panel.tsx backend/app/api/notes.py backend/tests/test_cached_explanations_and_notes.py scripts/playwright_smoke.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "fix: keep notes and exports aligned with visible explanations"
```

### Task 6: Full Verification Pass

**Files:**
- Modify if needed: `/Users/shihaochen/github/Teaching-Learning-/scripts/playwright_smoke.py`
- Verify: `/Users/shihaochen/github/Teaching-Learning-/backend/tests`

**Step 1: Run backend test suite**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q`

Expected: all tests pass

**Step 2: Run frontend production build**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/frontend && npm run build`

Expected: successful Next.js production build

**Step 3: Run smoke flow**

Run: `cd /Users/shihaochen/github/Teaching-Learning- && python scripts/playwright_smoke.py`

Expected: `all smoke checks passed`

**Step 4: Commit**

```bash
git -C /Users/shihaochen/github/Teaching-Learning- add scripts/playwright_smoke.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "test: verify extraction and generation workflow"
```
