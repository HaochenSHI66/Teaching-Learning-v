# Study Workbench Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add document deletion, redesign the learning workspace UI, and upgrade explanation prompt generation for richer Chinese Markdown output with English term annotations.

**Architecture:** Keep the current FastAPI + Next.js architecture, but extend the document API with a destructive operation, move more state handling into the upload hook, and centralize explanation prompt composition in backend services so cached explanations and interactive answers share the same tone and format.

**Tech Stack:** FastAPI, SQLModel, pytest, Next.js, React, Tailwind, react-markdown

---

### Task 1: Add document deletion API

**Files:**
- Create: `backend/tests/test_document_deletion.py`
- Modify: `backend/app/api/documents.py`
- Modify: `backend/app/schemas.py`

**Step 1: Write the failing test**

Add a backend test that uploads a document, verifies it appears in the list, deletes it, and asserts list/status access fail afterward.

**Step 2: Run test to verify it fails**

Run: `cd backend && pytest -q tests/test_document_deletion.py`
Expected: FAIL because delete endpoint does not exist.

**Step 3: Write minimal implementation**

Implement a delete endpoint that removes document-linked rows and storage assets.

**Step 4: Run test to verify it passes**

Run: `cd backend && pytest -q tests/test_document_deletion.py`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend
git commit -m "feat: add document deletion flow"
```

### Task 2: Wire delete actions into the sidebar

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/hooks/useUpload.ts`
- Modify: `frontend/app/page.tsx`

**Step 1: Write the failing behavior check**

Define the expected flow: delete action removes the document card and clears current state when deleting the active document.

**Step 2: Run verification**

Run: `cd frontend && npm run build`
Expected: existing build still passes before changes.

**Step 3: Write minimal implementation**

Add delete API call, upload-hook state transition, and sidebar UI control.

**Step 4: Run verification**

Run: `cd frontend && npm run build`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend
git commit -m "feat: add sidebar document delete action"
```

### Task 3: Redesign the workspace visuals

**Files:**
- Modify: `frontend/app/globals.css`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/ai-panel.tsx`
- Modify: `frontend/components/slide-viewer.tsx`

**Step 1: Define the target surfaces**

Map header, sidebar, viewer, and AI panel into a consistent visual system.

**Step 2: Implement the redesign**

Introduce stronger typography, layered surfaces, and clearer hierarchy for creative but readable UI.

**Step 3: Run verification**

Run: `cd frontend && npm run build`
Expected: PASS.

**Step 4: Smoke-check runtime**

Run the local app and verify the top bar, sidebar, tabs, and slide viewer render correctly.

**Step 5: Commit**

```bash
git add frontend
git commit -m "feat: redesign study workspace UI"
```

### Task 4: Upgrade explanation prompt and Markdown output

**Files:**
- Create: `backend/app/services/prompt_templates.py`
- Modify: `backend/app/services/explanation_engine.py`
- Modify: `backend/app/services/explanation_cache.py`
- Modify: `backend/tests/test_cached_explanations_and_notes.py`

**Step 1: Write the failing tests**

Assert cached explanations and interactive explanations include Chinese sections, English term annotations, and Markdown callouts.

**Step 2: Run tests to verify failure**

Run: `cd backend && pytest -q tests/test_cached_explanations_and_notes.py`
Expected: FAIL on new content expectations.

**Step 3: Write minimal implementation**

Centralize the prompt contract and align generated Markdown output with it.

**Step 4: Run verification**

Run: `cd backend && pytest -q`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend
git commit -m "feat: enrich explanation prompt and markdown output"
```

### Task 5: Final verification

**Files:**
- Modify: `README.md`

**Step 1: Run full verification**

Run:
- `cd backend && pytest -q`
- `cd frontend && npm run build`

Expected: all pass.

**Step 2: Run runtime smoke**

Verify:
- document upload
- cached explanation load
- document delete
- export all explanations

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: refresh redesigned workbench notes"
```
