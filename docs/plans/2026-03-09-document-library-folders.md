# Document Library Folders Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add single-level subject folders to the document library and support drag-and-drop document moves between folders with persistent ordering.

**Architecture:** Introduce a `Folder` model plus `Document.folder_id/sort_order`, expose folder-centric APIs that return grouped documents for the sidebar, and replace the flat sidebar list with a `dnd-kit` powered folder/document panel. Persist order changes immediately after drag end with optimistic UI and rollback on failure.

**Tech Stack:** FastAPI, SQLModel, SQLite, React, Next.js, TypeScript, dnd-kit, pytest, Playwright.

---

### Task 1: Add backend schema coverage for folders

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_db_compatibility.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_documents_api.py`

**Step 1: Write the failing tests**
- Add a DB compatibility test asserting startup creates `folder` table and adds `document.folder_id` and `document.sort_order`.
- Add an API test asserting grouped folder listing returns `folders` and `uncategorized` sections.

**Step 2: Run tests to verify they fail**
Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_db_compatibility.py tests/test_documents_api.py`
Expected: FAIL because folder schema and grouped API do not exist.

**Step 3: Write minimal implementation**
- Add `Folder` model, schema exposure, and SQLite backfill.
- Add grouped list response support.

**Step 4: Run tests to verify they pass**
Run the same pytest command.
Expected: PASS.

**Step 5: Commit**
```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/models.py backend/app/schemas.py backend/app/db.py backend/tests/test_db_compatibility.py backend/tests/test_documents_api.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add folder schema for document library"
```

### Task 2: Add folder CRUD and move-document APIs

**Files:**
- Create: `/Users/shihaochen/github/Teaching-Learning-/backend/app/api/folders.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/main.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/app/schemas.py`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/backend/tests/test_documents_api.py`

**Step 1: Write the failing tests**
- Test create folder.
- Test rename folder.
- Test delete folder moves docs to uncategorized.
- Test move document to another folder and reorder within folder.

**Step 2: Run tests to verify they fail**
Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q tests/test_documents_api.py`
Expected: FAIL because routes are missing.

**Step 3: Write minimal implementation**
- Implement folder CRUD.
- Implement a move endpoint that accepts `document_id`, `target_folder_id`, `target_index`.
- Normalize `sort_order` after every mutation.

**Step 4: Run tests to verify they pass**
Run the same pytest command.
Expected: PASS.

**Step 5: Commit**
```bash
git -C /Users/shihaochen/github/Teaching-Learning- add backend/app/api/folders.py backend/app/main.py backend/app/schemas.py backend/tests/test_documents_api.py
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add folder management api"
```

### Task 3: Add frontend types and state for grouped library

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/lib/api.ts`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/hooks/useUpload.ts`

**Step 1: Write the failing tests**
- Add API contract coverage if existing frontend tests are available, otherwise add TypeScript-safe consumers first and rely on build failures.
- At minimum, wire a Playwright expectation later that grouped folders render.

**Step 2: Run build to verify it fails after type-first changes**
Run: `cd /Users/shihaochen/github/Teaching-Learning-/frontend && npm run build`
Expected: FAIL until new folder payloads are handled.

**Step 3: Write minimal implementation**
- Add `Folder`, `FolderDocumentGroup`, grouped list payloads, create/update/delete/move requests.
- Replace flat `documents` refresh with grouped library refresh while preserving `documentId`, `sessionId`, `slides`, and explanation cache flows.

**Step 4: Run build to verify it passes**
Run the same build command.
Expected: PASS.

**Step 5: Commit**
```bash
git -C /Users/shihaochen/github/Teaching-Learning- add frontend/lib/api.ts frontend/hooks/useUpload.ts
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add grouped document library state"
```

### Task 4: Build folder sidebar UI with drag and drop

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/app/page.tsx`
- Create: `/Users/shihaochen/github/Teaching-Learning-/frontend/components/document-library.tsx`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/app/globals.css`
- Modify: `/Users/shihaochen/github/Teaching-Learning-/frontend/package.json`

**Step 1: Write the failing UI test**
- Add a Playwright test asserting folders render and a document can be dragged into another folder.

**Step 2: Run test to verify it fails**
Run: `cd /Users/shihaochen/github/Teaching-Learning- && npx -y playwright test tests/e2e/document-library-folders.spec.ts`
Expected: FAIL because grouped UI and drag handlers do not exist.

**Step 3: Write minimal implementation**
- Add `dnd-kit` dependencies.
- Create a folder sidebar component with create-folder action, collapsible folder sections, document items, and drop targets.
- Keep upload, delete, current selection, and generation controls intact.

**Step 4: Run test/build to verify it passes**
Run:
- `cd /Users/shihaochen/github/Teaching-Learning- && npx -y playwright test tests/e2e/document-library-folders.spec.ts`
- `cd /Users/shihaochen/github/Teaching-Learning-/frontend && npm run build`
Expected: PASS.

**Step 5: Commit**
```bash
git -C /Users/shihaochen/github/Teaching-Learning- add frontend/package.json frontend/package-lock.json frontend/app/page.tsx frontend/components/document-library.tsx frontend/app/globals.css tests/e2e/document-library-folders.spec.ts
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "feat: add draggable folder sidebar"
```

### Task 5: Regression verification and integration cleanup

**Files:**
- Modify: `/Users/shihaochen/github/Teaching-Learning-/tests/e2e/ux-flow.spec.ts` if selectors need updates
- Modify: any touched backend/frontend files only if regressions are found

**Step 1: Run backend verification**
Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && pytest -q`
Expected: PASS.

**Step 2: Run frontend verification**
Run: `cd /Users/shihaochen/github/Teaching-Learning-/frontend && npm run build`
Expected: PASS.

**Step 3: Run browser verification**
Run: `cd /Users/shihaochen/github/Teaching-Learning- && npx -y playwright test tests/e2e/ux-flow.spec.ts tests/e2e/document-library-folders.spec.ts`
Expected: PASS.

**Step 4: Commit final cleanup**
```bash
git -C /Users/shihaochen/github/Teaching-Learning- add -A
git -C /Users/shihaochen/github/Teaching-Learning- commit -m "test: cover document folder management"
```
