# PRD: Code Optimization & Bug Fixes

## Introduction

Comprehensive code quality audit and bug fixing for the Teaching-Learning (幻灯片研习台) application. Addresses security vulnerabilities, race conditions, middleware ordering, and code correctness issues identified during the previous code review session.

## Goals

- Fix all P1 security vulnerabilities (missing user-scoping on document endpoints)
- Eliminate race conditions in frontend upload/polling logic
- Fix CORS middleware ordering to ensure proper header injection
- Correct monthly page limit calculation
- Add automated test coverage for critical paths

## User Stories

### US-001: Add user-scoping to list_documents endpoint
**Description:** As a user, I want to only see my own documents so that other users cannot view my files.

**Acceptance Criteria:**
- [ ] `list_documents` endpoint accepts `current_user` via `get_optional_user` dependency
- [ ] When authenticated, filters `Document.user_id == current_user.id`
- [ ] When unauthenticated, returns only documents with `user_id IS NULL`
- [ ] Typecheck passes

### US-002: Add user-scoping to delete_document endpoint
**Description:** As a user, I want to ensure only I can delete my own documents so that my files are protected from other users.

**Acceptance Criteria:**
- [ ] `delete_document` endpoint accepts `current_user` via `get_optional_user` dependency
- [ ] Returns 403 if `document.user_id != current_user.id` (and document has a user_id)
- [ ] Unauthenticated users can only delete documents with `user_id IS NULL`
- [ ] Typecheck passes

### US-003: Fix CORS middleware ordering
**Description:** As a developer, I need CORS headers to be properly injected on all responses, including error responses, so that the frontend can handle errors correctly.

**Acceptance Criteria:**
- [ ] `RequestLoggingMiddleware` is added BEFORE `CORSMiddleware` (so CORS wraps the outermost layer)
- [ ] Swap the order: `app.add_middleware(RequestLoggingMiddleware)` then `app.add_middleware(CORSMiddleware, ...)` (Starlette applies them in reverse order)
- [ ] Verify CORS headers appear on 4xx/5xx error responses
- [ ] Typecheck passes

### US-004: Fix check_monthly_page_limit to count pages not rows
**Description:** As a developer, I need the monthly page limit to count actual pages processed, not LLMUsage rows, so that the limit accurately reflects usage.

**Acceptance Criteria:**
- [ ] `check_monthly_page_limit` sums a page-count field (e.g. `LLMUsage.page_count`) instead of counting rows
- [ ] If no `page_count` column exists on LLMUsage, add it or use `Document.page_count` as the source of truth
- [ ] `get_usage_stats` returns correct page counts
- [ ] Typecheck passes

### US-005: Cancel background polling when document changes in useUpload
**Description:** As a user, I want background polling to stop when I switch documents so that stale status updates don't overwrite my current view.

**Acceptance Criteria:**
- [ ] `handleUpload` stores an AbortController ref for the background polling IIFE
- [ ] `loadDocument` cancels any active background poll before starting
- [ ] `pollDocumentReady` in `api.ts` accepts an `AbortSignal` parameter
- [ ] Switching documents during upload polling does not cause stale `setStatusText` calls
- [ ] Typecheck passes

### US-006: Fix auto-generation race condition in hydrateDocument
**Description:** As a developer, I need the fire-and-forget auto-generation in `hydrateDocument` to be cancellable so that switching documents doesn't cause stale state updates.

**Acceptance Criteria:**
- [ ] Auto-generation IIFE (lines 178-191 in useUpload.ts) uses a ref to track if the document has changed
- [ ] `setCachedExplanations` and `setSlides` calls inside the IIFE check if `documentId` still matches before updating
- [ ] Loading a different document aborts any in-flight auto-generation
- [ ] Typecheck passes

### US-007: Write backend API tests for document endpoints
**Description:** As a developer, I want automated tests for document CRUD endpoints so that regressions are caught early.

**Acceptance Criteria:**
- [ ] Test file `tests/test_documents_api.py` exists
- [ ] Tests cover: upload (success + size limit), list (user-scoped), delete (owner + non-owner), status polling
- [ ] Tests use a test database (SQLite in-memory or temp file)
- [ ] All tests pass

### US-008: Write Playwright E2E tests for critical flows
**Description:** As a developer, I want automated E2E tests covering login, upload, and document viewing so that UI regressions are caught.

**Acceptance Criteria:**
- [ ] Test script covers: login page render, login flow, document list, theme toggle, user dropdown
- [ ] Tests run headless with Playwright Chromium
- [ ] Screenshots saved for debugging
- [ ] All tests pass

### US-009: Add user-scoping to document detail/slides/explanations endpoints
**Description:** As a user, I want document detail endpoints to verify ownership so that other users cannot access my document content.

**Acceptance Criteria:**
- [ ] `get_document_status`, `list_document_slides`, `list_document_explanations` verify `document.user_id` matches current user
- [ ] Returns 404 (not 403) when document belongs to another user (prevents enumeration)
- [ ] Unauthenticated access still works for documents with `user_id IS NULL`
- [ ] Typecheck passes

## Functional Requirements

- FR-1: All document endpoints must validate user ownership before returning data
- FR-2: CORS middleware must be the outermost middleware layer
- FR-3: Monthly page limits must count actual pages, not API call rows
- FR-4: Background async operations must be cancellable when context changes
- FR-5: Automated tests must cover security-critical endpoints

## Non-Goals

- No changes to the login/register UI design
- No new features or UI enhancements
- No database schema migrations (unless required for page count tracking)
- No performance optimization beyond the identified issues

## Technical Considerations

- FastAPI middleware order: Starlette applies middleware in reverse `add_middleware` order — last added = outermost
- `useUpload.ts` fire-and-forget IIFEs need ref-based cancellation since they capture stale closures
- `pollDocumentReady` needs `AbortSignal` threading through to `fetch`
- SQLite doesn't support concurrent writes well — background task commits should remain windowed

## Success Metrics

- Zero security vulnerabilities in document access (user A cannot see/delete user B's documents)
- No stale state updates when rapidly switching documents during upload
- CORS headers present on all responses including errors
- All automated tests passing

## Open Questions

- Does `LLMUsage` have a `page_count` column, or should we derive it from `Document.page_count`?
- Should we add rate limiting to the delete endpoint?
