# PPT Learning Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MVP that supports document upload, slide preprocessing, per-slide explanation chat, and markdown note export in a split-screen UI.

**Architecture:** Use a monorepo with FastAPI backend and Next.js frontend. Backend owns document processing and chat/note APIs; frontend provides split viewer and interaction tabs. Storage uses local files and SQLite in MVP while keeping model/service boundaries for later upgrades.

**Tech Stack:** FastAPI, SQLModel, Pillow/PyMuPDF, pytest, Next.js, React, Tailwind, TypeScript

---

### Task 1: Bootstrap repository structure

**Files:**
- Create: `backend/pyproject.toml`
- Create: `frontend/package.json`
- Create: `docker-compose.yml`
- Create: `.gitignore`
- Create: `README.md`

**Step 1: Write the failing test**

Create a repository smoke test that asserts backend app import path exists.

**Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_bootstrap.py -v`
Expected: FAIL because `app.main` not found.

**Step 3: Write minimal implementation**

Create backend package skeleton and frontend package scaffold files.

**Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_bootstrap.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add .
git commit -m "chore: bootstrap monorepo skeleton"
```

### Task 2: Implement document upload and slide listing APIs

**Files:**
- Create: `backend/app/api/documents.py`
- Create: `backend/app/services/slide_processor.py`
- Create: `backend/tests/test_documents_api.py`
- Modify: `backend/app/main.py`

**Step 1: Write the failing test**

Add API tests for uploading a PDF/image and listing generated slides.

**Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_documents_api.py -v`
Expected: FAIL with 404/500.

**Step 3: Write minimal implementation**

Implement upload endpoint, store file, preprocess pages, and list slides.

**Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_documents_api.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend
git commit -m "feat: add upload and slide listing APIs"
```

### Task 3: Implement session chat and markdown note export

**Files:**
- Create: `backend/app/api/sessions.py`
- Create: `backend/app/api/chat.py`
- Create: `backend/app/api/notes.py`
- Create: `backend/app/services/explanation_engine.py`
- Create: `backend/tests/test_learning_flow_api.py`

**Step 1: Write the failing test**

Add integration test: create session -> ask slide-bound question -> export markdown notes.

**Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_learning_flow_api.py -v`
Expected: FAIL because endpoints do not exist.

**Step 3: Write minimal implementation**

Add session/chat/notes APIs and deterministic explanation output.

**Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_learning_flow_api.py -v`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend
git commit -m "feat: add slide chat and notes export APIs"
```

### Task 4: Implement split-screen frontend MVP

**Files:**
- Create: `frontend/app/page.tsx`
- Create: `frontend/components/slide-viewer.tsx`
- Create: `frontend/components/ai-panel.tsx`
- Create: `frontend/lib/api.ts`
- Modify: `frontend/tailwind.config.ts`

**Step 1: Write the failing test**

Add a smoke build check for frontend page compilation.

**Step 2: Run test to verify it fails**

Run: `cd frontend && npm run build`
Expected: FAIL due to missing components.

**Step 3: Write minimal implementation**

Build split-screen page with upload, page navigation, explanation tab, chat tab, and notes export button.

**Step 4: Run test to verify it passes**

Run: `cd frontend && npm run build`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend
git commit -m "feat: add split-screen learning interface"
```

### Task 5: End-to-end verification and docs

**Files:**
- Modify: `README.md`
- Create: `backend/tests/test_end_to_end_flow.py`

**Step 1: Write the failing test**

Add API flow test covering upload -> slides -> session -> chat -> export.

**Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_end_to_end_flow.py -v`
Expected: FAIL on missing assumptions.

**Step 3: Write minimal implementation**

Patch any failing edge paths and document run instructions.

**Step 4: Run test to verify it passes**

Run:
- `cd backend && pytest -q`
- `cd frontend && npm run build`

Expected: all pass.

**Step 5: Commit**

```bash
git add README.md backend frontend
git commit -m "docs: add runbook and complete MVP verification"
```
