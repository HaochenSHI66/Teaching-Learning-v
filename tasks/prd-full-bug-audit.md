# PRD: Full Bug Audit & Fix - Teaching-Learning

## Introduction

Comprehensive bug audit of the Teaching-Learning (PPT Split-Screen Learning Assistant) project. Four parallel audits identified **120+ issues** across backend auth, frontend state management, services, and deployment configuration. This PRD organizes all fixes into dependency-ordered, Ralph-sized user stories.

## Goals

- Fix all CRITICAL auth bypass vulnerabilities (40+ unprotected endpoints)
- Fix all race conditions in frontend hooks (useUpload, useChat, useSlideGeneration)
- Fix resource leaks and error handling in backend services
- Fix deployment/configuration security gaps
- Ensure all endpoints enforce user isolation (multi-tenant safety)

## Severity Summary

| Category | Critical | High | Medium | Total |
|----------|----------|------|--------|-------|
| Backend Auth Bypass | 13 files | - | - | ~40 endpoints |
| Frontend Race Conditions | 5 | 9 | 6 | 20 |
| Backend Service Bugs | 7 | 5 | 3 | 15 |
| Deployment/Config | 3 | 2 | 7 | 12 |

---

## Phase 1: Backend Auth & User Isolation (CRITICAL)

### US-001: Add auth helper for document ownership check
Add a reusable `_require_document_owner(document_id, user_id, session)` to `deps.py` that raises 403 if not owner.

### US-002: Fix folders.py - Add auth to all 5 endpoints
All folder endpoints (list, create, update, delete, move_document) lack authentication entirely. Add `get_current_user` dependency and filter all queries by `user_id`.

### US-003: Fix sessions.py - Add auth to create/get session
`create_session` and `get_session` have no user check. Add `get_current_user` and filter `LearningSession` by `user_id`.

### US-004: Fix chat.py - Add auth to chat/stream/roi endpoints
`chat_on_slide`, `chat_stream`, `explain_roi` have no authentication. Add `get_current_user` and validate session ownership.

### US-005: Fix notebooks.py - Add auth to all 4 endpoints
`get_document_notebook`, `save_document_notebook`, `autogen_document_notebook`, `export_document_notebook` have no user ownership check.

### US-006: Fix notes.py - Add auth to export/autogen
`export_notes_markdown` and `autogen_notes_from_cached_explanations` have no user validation.

### US-007: Fix slide_notes.py - Add auth to all 6 endpoints
All slide note endpoints (list, get, save, generate, generate_all, export) lack user ownership checks.

### US-008: Fix bookmarks.py - Add auth to all 3 endpoints
`list_bookmarks`, `create_bookmark`, `delete_bookmark` have no authentication.

### US-009: Fix flashcards.py - Add auth to all 6 endpoints
All flashcard endpoints lack user ownership checks.

### US-010: Fix quizzes.py - Add auth to generate/grade
`generate_slide_quiz` and `grade_slide_quiz` have no user check.

### US-011: Fix review.py - Add auth to queue/complete
`get_review_queue` and `complete_review_item` have no user ownership check.

### US-012: Fix analytics.py - Add auth
`get_session_analytics` has no user ownership check.

### US-013: Fix knowledge_graph.py - Add auth to all 4 endpoints
All knowledge graph endpoints lack user ownership checks.

### US-014: Fix export_notes.py - Add auth to preview/download
`preview_notes` and `download_notes` have no user check.

### US-015: Fix usage.py - Enforce auth
`get_user_usage` uses `get_optional_user`, should use `get_current_user`.

---

## Phase 2: Backend Configuration & Security (CRITICAL)

### US-016: Fix CORS middleware ordering in main.py
`RequestLoggingMiddleware` added AFTER `CORSMiddleware` - Starlette applies in reverse order, so CORS headers missing on error responses. Swap the order.

### US-017: Restrict CORS methods/headers in main.py
`allow_methods=["*"]` and `allow_headers=["*"]` too permissive. Restrict to specific methods and headers.

### US-018: Enforce JWT_SECRET in production
Currently generates random secret on startup if not set. Add startup check that raises error if JWT_SECRET not in env and ENVIRONMENT=production.

### US-019: Fix health check to verify DB connectivity
`GET /health` only returns `{"status": "ok"}` without checking database. Add DB ping.

---

## Phase 3: Backend Service Bugs (HIGH)

### US-020: Fix model_gateway.py streaming error swallowing
Line 254: bare `except Exception: continue` swallows all streaming errors silently. Add logging and specific exception types.

### US-021: Fix model_gateway.py image resource leak
Line 368: `Image.open(image_path)` without context manager causes file descriptor leaks under heavy load.

### US-022: Fix slide_processor.py pixmap/image resource leaks
Lines 140, 281-283: `image.crop()` results and pixmaps never closed. Add explicit cleanup.

### US-023: Fix dual_pipeline.py thread safety and JSON parse
Line 31: global engine creation has race condition. Line 66: unhandled JSON parse exception.

### US-024: Fix chat_engine.py Chinese token estimation
Line 43: `_estimate_tokens()` assumes 3 chars/token, but Chinese text needs ~1.5 tokens/char. History trimming too aggressive for Chinese.

### US-025: Fix retrieval.py Chinese text matching
Line 9: `TOKEN_PATTERN` requires 3+ chars, missing 2-char Chinese terms. Line 21-24: single char indexing incomplete.

### US-026: Fix cost_tracker.py daemon thread and engine leak
Line 84: daemon thread loses cost data on shutdown. Line 69: engine created but never disposed.

### US-027: Fix quiz_engine.py hardcoded answers
Lines 30-52: all quiz answers hardcoded to "A", no real content differentiation by slide.

---

## Phase 4: Frontend Race Conditions (HIGH)

### US-028: Fix useUpload.ts auto-generation race condition
Lines 183-197: fire-and-forget async IIFE captures stale `documentId`. Add `autoGenDocRef` guard and abort on document switch.

### US-029: Fix useUpload.ts polling abort on document switch/delete
Lines 248-271, 279-315: polling not cancelled on delete; `pollAbortRef` can be null. Add proper cleanup.

### US-030: Fix useChat.ts missing abort signals and stale closures
Lines 49-84: no AbortSignal for API calls, no cleanup on slide/document switch. Add abort controller.

### US-031: Fix useChat.ts message ID collision
Lines 14-17: `Date.now()` can collide under rapid requests. Use counter or crypto.randomUUID().

### US-032: Fix useSlideGeneration.ts progress calculation bug
Lines 284-289: if vision stage takes <8s, `elapsed - 8` goes negative, breaking progress bar width.

### US-033: Fix useSlideGeneration.ts unmount state update
Line 88: `setTimeout` may fire after component unmount. Add cleanup ref.

### US-034: Fix api.ts streaming error handling and abort
Lines 496-569: no error handling in reader loop, abort signal not checked. Add proper error boundary and signal check.

### US-035: Fix api.ts downloadExportNotes missing auth token
Lines 1029-1053: manual fetch doesn't use `request()` helper, token injection may fail.

---

## Phase 5: Frontend UI Bugs (MEDIUM)

### US-036: Fix slide-viewer.tsx duplicate keyboard listeners
Lines 61-83: event listener re-added on every index change without removing old one.

### US-037: Fix document-library.tsx optimistic update rollback
Lines 350-372: failed moves don't properly restore state when multiple moves race.

### US-038: Fix flashcard-review.tsx stale cards reference
Line 151: keyboard handler deps array missing `cards`, uses stale reference.

### US-039: Fix export-notes-modal.tsx fetch cancellation race
Lines 72-89: modal close during fetch causes state update on unmounted component.

### US-040: Fix page.tsx stale closure in handleElaborateSelection
Line 139: `chat.explanation` read from stale closure, not from current state.

---

## Phase 6: Deployment & Config (MEDIUM)

### US-041: Add USER directive to backend Dockerfile
Running as root in container. Add non-root user.

### US-042: Add USER directive to frontend Dockerfiles
Both frontend Dockerfiles run as root.

### US-043: Fix docker-compose.yml weak default password
Line 7: hardcoded `teaching_pass_CHANGE_ME` fallback.

### US-044: Fix start.sh unsafe host binding
Line 21: frontend binds to `0.0.0.0` in dev, exposing to entire network.

---

## Non-Goals

- No new features (only bug fixes and security hardening)
- No refactoring beyond what's needed for fixes
- No test coverage expansion (separate PRD)
- No CI/CD pipeline setup
- No monitoring/alerting setup

## Success Metrics

- All endpoints require authentication (zero `get_optional_user` in protected routes)
- Zero resource leaks under 100 concurrent uploads
- Zero race conditions when rapidly switching documents
- All containers run as non-root
- CORS correctly configured for production
