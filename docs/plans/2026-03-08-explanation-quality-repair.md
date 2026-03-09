# Explanation Quality Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent stale low-quality explanation caches from surfacing, sanitize generated headings, and lazily refresh legacy slide extracts.

**Architecture:** Add version checks around slide extracts and explanations, sanitize markdown before persistence, and re-run deterministic extraction for stale documents using the existing document processor. Keep model calls explicit and separate from extract refresh.

**Tech Stack:** FastAPI, SQLModel, SQLite, PyMuPDF, pytest, Playwright

---

### Task 1: Add failing regression tests for legacy extract and explanation caches

**Files:**
- Modify: `backend/tests/test_documents_api.py`

**Step 1: Write failing test**
- Upload a PDF document
- Mutate `slideextract.payload` into a legacy minimal payload
- Mutate `slideexplanation.markdown` into a placeholder-heading legacy explanation
- Assert `/slides` returns refreshed `text_blocks`
- Assert `/slides` reports `explanation_state = not_generated`
- Assert `/explanations` excludes the stale explanation

**Step 2: Run the targeted test to verify it fails**
Run: `cd backend && pytest -q tests/test_documents_api.py -k legacy`

**Step 3: Commit after green**
Run after implementation: `git commit -m "test: cover legacy explanation cache refresh"`

### Task 2: Add failing unit tests for markdown sanitization

**Files:**
- Create or modify: `backend/tests/test_explanation_engine.py`

**Step 1: Write failing test**
- Feed placeholder markdown like `## Slide 标题`
- Provide extract payload with title candidates
- Assert sanitized markdown uses the real title and removes the placeholder heading

**Step 2: Run the targeted test to verify it fails**
Run: `cd backend && pytest -q tests/test_explanation_engine.py`

**Step 3: Commit after green**
Run after implementation: `git commit -m "test: cover explanation markdown sanitization"`

### Task 3: Implement extract and explanation versioning

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/db.py`
- Modify: `backend/app/api/documents.py`
- Modify: `backend/app/api/notes.py`

**Step 1: Add current-version constants and schema support**
- Add `version` to `SlideExplanation`
- Backfill SQLite with default version column
- Add extract schema version helper based on payload JSON

**Step 2: Implement stale detection and lazy refresh**
- Add helpers to detect stale extract payloads and stale explanations
- Re-run `process_document(...)` for a document when extracts are stale
- Update existing `SlideExtract` rows by page number

**Step 3: Verify targeted tests**
Run: `cd backend && pytest -q tests/test_documents_api.py -k legacy`

### Task 4: Sanitize explanation markdown before persistence

**Files:**
- Modify: `backend/app/services/explanation_engine.py`
- Modify: `backend/app/services/prompt_templates.py` if needed

**Step 1: Implement title selection + markdown sanitization**
- Derive best title from extract payload
- Replace placeholder headings
- Prepend a valid heading if missing

**Step 2: Wire sanitization into live generation and fallback generation**
- Sanitize before returning and before writing to DB

**Step 3: Verify targeted tests**
Run: `cd backend && pytest -q tests/test_explanation_engine.py`

### Task 5: Improve extract quality for title/text block usefulness

**Files:**
- Modify: `backend/app/services/slide_processor.py`
- Modify: `backend/tests/test_documents_api.py`

**Step 1: Ignore page-number-only blocks and keep richer title candidates**

**Step 2: Verify the structured extraction test still passes**
Run: `cd backend && pytest -q tests/test_documents_api.py -k structured`

### Task 6: Full verification and manual quality check

**Files:**
- No code changes required

**Step 1: Run backend test suite**
Run: `cd backend && pytest -q`

**Step 2: Run frontend build**
Run: `cd frontend && npm run build`

**Step 3: Run Playwright explanation flow**
Run: `cd .. && npx -y playwright test tests/e2e/explanation-flow.spec.ts`

**Step 4: Manually inspect regenerated pages in Playwright**
- Validate no `Slide 标题`
- Validate stale extracts now show `text_blocks` / `figures`
- Validate regenerated explanation uses bilingual titles and Markdown sections
