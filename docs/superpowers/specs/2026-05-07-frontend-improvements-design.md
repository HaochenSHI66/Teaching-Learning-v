# Frontend Improvements Design — 2026-05-07

## Scope

Four independent improvements to the slide study app at learn.shc66.com:

1. Thumbnail strip auto-sync
2. Hover-to-highlight explanation items
3. Global cross-document chat
4. Switch text model to DeepSeek V4 Flash

---

## Feature 1 — Thumbnail Strip Auto-Sync

**Goal:** When the user navigates to a different slide, the thumbnail strip scrolls so the active thumbnail stays visible (centered).

**Location:** `frontend/components/slide-viewer.tsx`

**Implementation:**
- Use a `Map<number, HTMLButtonElement>` ref (keyed by slide index) rather than a plain array, because the thumbnail strip conditionally renders items (bookmark filter). Populate via `ref={el => { if (el) thumbRefs.current.set(index, el) }}` on each thumbnail button.
- In a `useEffect` that depends on `currentIndex`, call `thumbRefs.current.get(currentIndex)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })`.
- No new state needed. No visual design change.

**Edge cases:** First/last slide and filtered-out thumbnails — `scrollIntoView` handles gracefully; missing map entries are a safe no-op.

---

## Feature 2 — Hover-to-Highlight Explanation Items

**Goal:** When the user hovers over a region of the slide image, the corresponding explanation item in the right panel gets a subtle highlight. Click locks the highlight.

**Design decision (PM-approved):** Vertical zone division — divide slide height into N equal bands where N = number of structured explanation items. Hovering band k highlights item k.

**Applies to:** Only the structured-items rendering branch in `ai-panel.tsx` (the `StructuredContent` component / `explanationMeta.structured_items` array). In the markdown-only or not-yet-generated branches, the hover has no visible effect.

**State location:** `hoveredItemIndex: number | null` and `lockedItemIndex: number | null` live in `frontend/app/page.tsx` (the parent that renders both `SlideViewer` and `AIPanel`). `itemCount` is also derived at the page level from `explanationMeta.structured_items?.length ?? 0` and passed as a prop to `SlideViewer`.

**Data flow:**
```
page.tsx:  itemCount (from explanationMeta)
               ↓
slide-viewer.tsx (mouse position) → calls setHoveredItemIndex / setLockedItemIndex in page.tsx
               ↓
ai-panel.tsx (hoveredItemIndex | lockedItemIndex prop) → highlight CSS on matching item
```

**Highlight style:**
- Background: `rgba(59, 130, 246, 0.12)` (blue-tinted, non-obtrusive)
- Left border: `3px solid #3B82F6`
- Transition: `background 0.15s ease`

**Lock behavior:**
- Click sets `lockedItemIndex = newIndex`.
- If `lockedItemIndex === newIndex` (clicking same band again), set `lockedItemIndex = null` (unlock).
- Escape key sets `lockedItemIndex = null`.
- Active highlight = `lockedItemIndex ?? hoveredItemIndex`.

**Mobile:** `onMouseMove`/`onMouseLeave`/`onClick` are pointer events — wrap in a `isPointer` guard (`window.matchMedia('(pointer: fine)')`) or simply let touch-only devices never trigger these events (mouse events don't fire on touch screens).

**Affected files:**
- `frontend/app/page.tsx` — add `hoveredItemIndex`, `lockedItemIndex`, derive `itemCount`, pass all to children
- `frontend/components/slide-viewer.tsx` — add `onMouseMove`, `onMouseLeave`, `onClick` to slide image container; compute band index from `e.nativeEvent.offsetY / containerHeight * itemCount`; call prop callbacks
- `frontend/components/ai-panel.tsx` — accept `hoveredItemIndex` and `lockedItemIndex` props; compute `activeHighlight = lockedItemIndex ?? hoveredItemIndex`; apply highlight class to item at `activeHighlight` index in `StructuredContent`

---

## Feature 3 — Global Cross-Document Chat

**Goal:** The chat panel shows a "全局" (global) tab in addition to the existing per-slide chat. The global tab loads all messages for the current user across all documents, each message showing a source badge (filename + page number). Manual "Clear" button deletes all messages from DB.

**UI structure:** Inside the existing chat panel, add a tab toggle:
```
[本页] [全局]
```
Default: "本页" (current behavior). Switching to "全局" loads and shows all messages across all documents.

**Source badge format:** `filename · P{page}` — e.g., `OS_Lec3.pdf · P5`. Shown on each message bubble. Clickable navigation to that document/page is **deferred** — badges are display-only in this iteration to avoid the complex cross-document state reset (resets session, slides, chat, thumbnails).

**Backend changes:**

1. `GET /api/v1/chat/global` — returns all messages for current user ordered by `created_at` DESC, max 200. Auth: uses existing `get_current_user` dependency (same as all other chat endpoints). Returns array of message objects with extra fields: `filename`, `page_num` (nullable).

2. `DELETE /api/v1/chat/global` — deletes all Message records reachable via `Message → LearningSession → Document.user_id = current_user.id`. Auth: same `get_current_user` dep.

**Correct DB query for `GET /api/v1/chat/global`:**
```sql
SELECT m.id, m.session_id, m.role, m.content, m.created_at,
       d.filename,
       s.page_num
FROM message m
JOIN learningsession ls ON m.session_id = ls.id
JOIN document d ON ls.document_id = d.id
LEFT JOIN slide s ON m.slide_id = s.id
WHERE d.user_id = ?
ORDER BY m.created_at DESC
LIMIT 200
```

Note: join is on `slide` table (not `slideexplanation`) because `m.slide_id` is nullable and refers to `Slide.id`. Global-mode messages have `slide_id = NULL`, so `s.page_num` will be NULL for those — badge shows filename only.

**Frontend changes:**
- `frontend/components/ai-panel.tsx` — add `chatTab: 'local' | 'global'` state; when `global` is selected, call `GET /api/v1/chat/global` and render the result list with source badges; Clear button calls `DELETE /api/v1/chat/global` then re-fetches.
- `frontend/hooks/useChat.ts` — extend existing hook: add a `fetchGlobalMessages()` function that hits the new endpoint. No new hook file.

---

## Feature 4 — Switch Text Model to DeepSeek V4 Flash

**Goal:** Replace the current text LLM (qwen-plus-latest) with DeepSeek V4 Flash for all text-only generation (chat replies, non-vision tasks).

**Change:** Update `backend/.env`:
```
TEXT_API_KEY=$DEEPSEEK_API_KEY
TEXT_BASE_URL=https://api.deepseek.com
TEXT_MODEL=deepseek-v4-flash
```

No code changes required — `ModelGateway` already reads `TEXT_API_KEY`, `TEXT_BASE_URL`, `TEXT_MODEL` env vars.

**Risk:** `.env` is gitignored. Change must be applied directly on the server. Verify by restarting the backend service and checking a chat response.

**Model ID verification:** Before applying, confirm `deepseek-v4-flash` is a valid model ID by checking DeepSeek's API models list. If the name is wrong, the gateway will return a 404 or model-not-found error. Correct model ID at time of writing: `deepseek-chat` (stable) or check https://api.deepseek.com for v4-flash availability.

---

## Constraints

- No mock data or fake fallbacks in production code
- Match existing TypeScript/React patterns in the codebase
- No new npm packages unless strictly necessary
- Backend: SQLite only, no ORM changes to schema (use existing tables)
- All changes must work with the existing Cloudflare Tunnel deployment (frontend :13900, backend :18920)
