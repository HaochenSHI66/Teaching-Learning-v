# Frontend Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four independent improvements — thumbnail auto-scroll, hover-to-highlight explanations, global cross-document chat, and DeepSeek V4 Flash as the text model.

**Architecture:** Feature 1 is a pure DOM side-effect in SlideViewer. Feature 2 lifts two state variables to page.tsx and threads them through props. Feature 3 adds two backend endpoints and extends the existing useChat hook. Feature 4 is a backend .env change.

**Tech Stack:** Next.js 15 / React 19, TypeScript, FastAPI, SQLite/SQLModel, TailwindCSS.

---

## Chunk 1: Thumbnail Strip Auto-Scroll

### Task 1: Scroll active thumbnail into view on slide change

**Files:**
- Modify: `frontend/components/slide-viewer.tsx`

**Context:** The thumbnail strip is a horizontal scrollable div (lines 356-414). Thumbnails are conditionally rendered based on `bookmarkFilter`, so some indices may be skipped — a plain array ref won't work. We need a `Map<number, HTMLButtonElement>` keyed by slide index.

- [ ] **Step 1: Add the ref map**

  In `slide-viewer.tsx`, after the existing refs (search for `useRef` near line 25-30), add:

  ```typescript
  const thumbRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  ```

- [ ] **Step 2: Populate the map on each thumbnail button**

  In the thumbnail `<button>` element (around line 370 — the one with `onClick={() => onSelect(index)}`), add a `ref` callback:

  ```typescript
  ref={(el) => {
    if (el) thumbRefs.current.set(index, el);
    else thumbRefs.current.delete(index);
  }}
  ```

- [ ] **Step 3: Add the scroll effect**

  After the existing `useEffect` blocks, add:

  ```typescript
  useEffect(() => {
    thumbRefs.current.get(currentIndex)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [currentIndex]);
  ```

- [ ] **Step 4: TypeScript check**

  ```bash
  cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 5: Verify manually**

  ```bash
  npm run dev
  ```

  Load a PDF, press arrow keys or click thumbnails. The strip should scroll to keep the active thumbnail visible.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/components/slide-viewer.tsx
  git commit -m "feat: auto-scroll thumbnail strip to active slide"
  ```

---

## Chunk 2: Hover-to-Highlight Explanation Items

### Task 2: Lift hover state to page.tsx and thread props

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/slide-viewer.tsx`
- Modify: `frontend/components/ai-panel.tsx`

**Context:**
- `hoveredItemIndex` and `lockedItemIndex` live in `page.tsx`.
- `page.tsx` accesses `chat.explanationMeta` — derive `itemCount` from `chat.explanationMeta?.structured_items?.length ?? 0`.
- `SlideViewer` receives `itemCount` and two callbacks: `onHoverItem` and `onLockItem`.
- `AIPanel` receives `hoveredItemIndex` and `lockedItemIndex` and applies highlight to matching `structured_items` entry.
- Highlight applies ONLY to the `StructuredContent` branch (when `explanationMeta.structured_items` is present — lines 361-374 in ai-panel.tsx). Other branches are unaffected.
- The slide image container (around line 280 in slide-viewer.tsx) already has `onMouseMove` and `onMouseLeave` handlers for ROI drag. The new hover logic must be **merged** into those existing handlers — do NOT add duplicate event handlers.

**Step 1: Add state and callbacks to `page.tsx`**

- [ ] Find the state declarations block (around line 39-51 in page.tsx). Add:

  ```typescript
  const [hoveredItemIndex, setHoveredItemIndex] = useState<number | null>(null);
  const [lockedItemIndex, setLockedItemIndex] = useState<number | null>(null);
  ```

- [ ] Derive `itemCount` from the existing `chat.explanationMeta` (no cast needed — `structured_items` is already typed):

  ```typescript
  const explanationItemCount = chat.explanationMeta?.structured_items?.length ?? 0;
  ```

- [ ] Add a keyboard effect for Escape (after existing useEffect blocks):

  ```typescript
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLockedItemIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  ```

**Step 2: Pass new props to `SlideViewer`**

- [ ] Find the `<SlideViewer ... />` block (around lines 503-515 in page.tsx). Add three props:

  ```typescript
  itemCount={explanationItemCount}
  onHoverItem={setHoveredItemIndex}
  onLockItem={(index) => {
    setLockedItemIndex((prev) => (prev === index ? null : index));
  }}
  ```

**Step 3: Pass highlight props to `AIPanel`**

- [ ] Find the `<AIPanel ... />` block (around lines 555-592 in page.tsx). Add:

  ```typescript
  hoveredItemIndex={hoveredItemIndex}
  lockedItemIndex={lockedItemIndex}
  ```

**Step 4: Add new props to `SlideViewerProps` and merge into existing mouse handlers**

- [ ] In `slide-viewer.tsx`, extend the `SlideViewerProps` type (lines 11-23):

  ```typescript
  itemCount?: number;
  onHoverItem?: (index: number | null) => void;
  onLockItem?: (index: number | null) => void;
  ```

- [ ] Destructure the new props at the top of the component body:

  ```typescript
  const { ..., itemCount = 0, onHoverItem, onLockItem } = props;
  ```

- [ ] Find the existing `onMouseMove` handler on the slide image container (around line 292). That handler manages ROI drag state. **Append** the hover band logic at the end of that handler (after existing ROI logic):

  ```typescript
  // append at end of existing onMouseMove handler:
  if (itemCount && onHoverItem) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const band = Math.min(Math.floor((relY / rect.height) * itemCount), itemCount - 1);
    onHoverItem(band);
  }
  ```

- [ ] Find the existing `onMouseLeave` handler (around line 289). Append:

  ```typescript
  // append at end of existing onMouseLeave handler:
  onHoverItem?.(null);
  ```

- [ ] Find the existing `onClick` handler on the slide image container (or add one if absent). Add the lock logic:

  ```typescript
  onClick={(e) => {
    if (!itemCount || !onLockItem) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const band = Math.min(Math.floor((relY / rect.height) * itemCount), itemCount - 1);
    onLockItem(band);
  }}
  ```

**Step 5: Add new props to `AIPanelProps` and apply highlight**

- [ ] In `ai-panel.tsx`, extend `AIPanelProps` (lines 15-43):

  ```typescript
  hoveredItemIndex?: number | null;
  lockedItemIndex?: number | null;
  ```

- [ ] Destructure them at the top of the component.

- [ ] Compute active highlight index:

  ```typescript
  const activeHighlight = lockedItemIndex ?? hoveredItemIndex ?? null;
  ```

- [ ] Find the `StructuredContent` rendering branch (around lines 361-374 — where `explanationMeta.structured_items` is mapped). For each item at array index `i`, add a conditional class to the outermost wrapper element of each item:

  ```typescript
  className={`... transition-colors duration-150 ${
    activeHighlight === i
      ? "bg-blue-50 border-l-[3px] border-blue-400 pl-2 -ml-2"
      : ""
  }`}
  ```

- [ ] **Step 6: TypeScript check**

  ```bash
  cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 7: Manual test**

  Load a slide with a generated explanation (structured items format). Hover over the top third of the slide image → first explanation item highlights. Hover middle → middle item highlights. Click → highlight locks. Click same band → unlocks. Press Escape → unlocks. Hover over a slide with no explanation → no crash, ROI drag still works.

- [ ] **Step 8: Commit**

  ```bash
  git add frontend/app/page.tsx frontend/components/slide-viewer.tsx frontend/components/ai-panel.tsx
  git commit -m "feat: hover over slide image highlights corresponding explanation item"
  ```

---

## Chunk 3: Global Cross-Document Chat

### Task 3: Backend — global chat endpoints

**Files:**
- Modify: `backend/app/api/chat.py`

**Context:** `Message` has `session_id → LearningSession → Document.user_id`. Auth uses `get_current_user` (already imported at the top of `chat.py`). `Message.slide_id` is nullable — join to `Slide` (not `SlideExplanation`) to get `page_num`. New endpoints go after the existing `POST /roi` endpoint.

FastAPI route ordering: `GET /global` and `DELETE /global` are safe to append after existing `POST ""`, `POST "/stream"`, `POST "/roi"` — none are parameterized catch-alls.

- [ ] **Step 1: Add required imports**

  At the top of `chat.py`, add these imports if not already present:
  ```python
  from pydantic import BaseModel
  from sqlalchemy import text
  ```

  Check the existing imports first (`grep -n "from pydantic\|from sqlalchemy" backend/app/api/chat.py`).

- [ ] **Step 2: Add Pydantic response model**

  Near the top of `chat.py` (after imports, before the first endpoint), add:

  ```python
  class GlobalMessageItem(BaseModel):
      id: str
      session_id: str
      role: str
      content: str
      created_at: str
      slide_id: str | None
      filename: str
      page_num: int | None
  ```

- [ ] **Step 3: Add `GET /api/v1/chat/global` endpoint**

  After the last existing endpoint in `chat.py` (`POST /roi`), add:

  ```python
  @router.get("/global", response_model=list[GlobalMessageItem])
  def get_global_messages(
      session: Session = Depends(get_db_session),
      current_user: User = Depends(get_current_user),
  ) -> list[GlobalMessageItem]:
      rows = session.execute(
          text(
              """
              SELECT m.id, m.session_id, m.role, m.content,
                     m.created_at, m.slide_id,
                     d.filename,
                     s.page_num
              FROM message m
              JOIN learningsession ls ON m.session_id = ls.id
              JOIN document d ON ls.document_id = d.id
              LEFT JOIN slide s ON m.slide_id = s.id
              WHERE d.user_id = :uid
              ORDER BY m.created_at DESC
              LIMIT 200
              """
          ),
          {"uid": current_user.id},
      ).fetchall()
      return [
          GlobalMessageItem(
              id=r[0],
              session_id=r[1],
              role=r[2],
              content=r[3],
              created_at=str(r[4]),
              slide_id=r[5],
              filename=r[6],
              page_num=r[7],
          )
          for r in rows
      ]
  ```

  Note: use `session.execute(text(...), {...})` — NOT `session.exec()`. The `exec()` method is for SQLModel select statements; `execute()` is for raw SQL via `text()`.

- [ ] **Step 4: Add `DELETE /api/v1/chat/global` endpoint**

  Use `status_code=200` (not 204) so the frontend's `request<T>()` can call `.json()` on the response body without throwing on an empty body.

  ```python
  @router.delete("/global")
  def delete_global_messages(
      session: Session = Depends(get_db_session),
      current_user: User = Depends(get_current_user),
  ) -> dict:
      session.execute(
          text(
              """
              DELETE FROM message
              WHERE session_id IN (
                  SELECT ls.id FROM learningsession ls
                  JOIN document d ON ls.document_id = d.id
                  WHERE d.user_id = :uid
              )
              """
          ),
          {"uid": current_user.id},
      )
      session.commit()
      return {"ok": True}
  ```

- [ ] **Step 5: Restart backend and test endpoints**

  ```bash
  cd /Users/shihaochen/github/Teaching-Learning-/backend
  python -m uvicorn app.main:app --reload --port 18920
  ```

  Then in another terminal:
  ```bash
  # Replace TOKEN with a real JWT from the running app (grab from browser devtools → Application → Cookies)
  curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18920/api/v1/chat/global | python3 -m json.tool | head -40
  ```

  Expected: JSON array (may be empty if no messages exist yet). No 422 or 500 errors.

- [ ] **Step 6: Commit backend**

  ```bash
  git add backend/app/api/chat.py
  git commit -m "feat: add GET/DELETE /api/v1/chat/global endpoints"
  ```

### Task 4: Frontend — global chat tab in AIPanel

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/hooks/useChat.ts`
- Modify: `frontend/components/ai-panel.tsx`
- Modify: `frontend/app/page.tsx`

**Context:**
- `api.ts` uses an internal `request<T>(path, init?, options?)` function. New API functions must use `request<T>` directly (it throws on non-OK responses automatically).
- `useChat.ts` already has `mode: "slide" | "global"` state and a mode toggle in `ai-panel.tsx` (lines 623-636).
- When mode is "global", show fetched global messages; source badge `filename · P{page}` is display-only.

**Step 1: Add type and API functions to `frontend/lib/api.ts`**

- [ ] At the end of `api.ts`, add:

  ```typescript
  export type GlobalMessageItem = {
    id: string;
    session_id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
    slide_id: string | null;
    filename: string;
    page_num: number | null;
  };

  export async function fetchGlobalMessages(): Promise<GlobalMessageItem[]> {
    return request<GlobalMessageItem[]>("/api/v1/chat/global");
  }

  export async function deleteGlobalMessages(): Promise<void> {
    await request<{ ok: boolean }>("/api/v1/chat/global", { method: "DELETE" });
  }
  ```

  `request<T>` is the internal function already used by all other API calls in this file. It handles auth headers and throws on non-OK. Do NOT use `fetch` or `apiFetch` directly.

**Step 2: Extend `useChat.ts` with global message state and methods**

- [ ] Add imports at the top of `useChat.ts`:

  ```typescript
  import { ..., fetchGlobalMessages, deleteGlobalMessages, type GlobalMessageItem } from "@/lib/api";
  ```

- [ ] Add state inside the `useChat` hook body:

  ```typescript
  const [globalMessages, setGlobalMessages] = useState<GlobalMessageItem[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  ```

- [ ] Add methods:

  ```typescript
  const loadGlobalMessages = useCallback(async () => {
    setGlobalLoading(true);
    try {
      const msgs = await fetchGlobalMessages();
      setGlobalMessages(msgs);
    } finally {
      setGlobalLoading(false);
    }
  }, []);

  const clearGlobalMessages = useCallback(async () => {
    await deleteGlobalMessages();
    setGlobalMessages([]);
  }, []);
  ```

- [ ] Add to return object:

  ```typescript
  return {
    // ...existing fields...
    globalMessages,
    globalLoading,
    loadGlobalMessages,
    clearGlobalMessages,
  };
  ```

**Step 3: Wire new props from `page.tsx` to `AIPanel`**

- [ ] In `ai-panel.tsx`, extend `AIPanelProps`:

  ```typescript
  globalMessages?: GlobalMessageItem[];
  globalLoading?: boolean;
  onLoadGlobalMessages?: () => void;
  onClearGlobalMessages?: () => void;
  ```

  Add import: `import type { GlobalMessageItem } from "@/lib/api";`

- [ ] In `page.tsx`, pass new props to `<AIPanel>`:

  ```typescript
  globalMessages={chat.globalMessages}
  globalLoading={chat.globalLoading}
  onLoadGlobalMessages={() => void chat.loadGlobalMessages()}
  onClearGlobalMessages={() => void chat.clearGlobalMessages()}
  ```

**Step 4: Render global messages in `ai-panel.tsx`**

- [ ] Add a `useEffect` that fetches when mode switches to global:

  ```typescript
  useEffect(() => {
    if (mode === "global") {
      onLoadGlobalMessages?.();
    }
  }, [mode]);
  ```

- [ ] In the chat tab message list area, wrap in a conditional on `mode`. The existing local message list becomes the `else` branch. The global branch:

  ```typescript
  {mode === "global" ? (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {globalLoading && (
        <p className="text-xs text-gray-400 text-center">加载中…</p>
      )}
      {(globalMessages ?? []).map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div className="max-w-[85%] space-y-1">
            <span className="block text-[10px] text-gray-400 px-1">
              {msg.filename}
              {msg.page_num != null ? ` · P${msg.page_num}` : ""}
            </span>
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-white text-gray-800 border border-gray-200"
              }`}
            >
              {msg.content}
            </div>
          </div>
        </div>
      ))}
      {!globalLoading && (globalMessages ?? []).length === 0 && (
        <p className="text-xs text-gray-400 text-center">暂无记录</p>
      )}
    </div>
  ) : (
    /* existing local messages JSX unchanged */
  )}
  ```

- [ ] Add the clear button in global mode (near the existing "清空当前页" button area):

  ```typescript
  {mode === "global" && (
    <button
      onClick={() => onClearGlobalMessages?.()}
      className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
    >
      清空全部记录
    </button>
  )}
  ```

- [ ] **Step 5: TypeScript check**

  ```bash
  cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx tsc --noEmit
  ```

  Expected: no errors.

- [ ] **Step 6: Manual test**

  1. Load the app, open a document, send two chat messages.
  2. Open another document, send a message.
  3. Click "全局" mode → should show messages from both documents with source badges (filename + page).
  4. Click "清空全部记录" → messages disappear.
  5. Switch back to "本页" → per-slide chat still works normally.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/hooks/useChat.ts frontend/components/ai-panel.tsx frontend/lib/api.ts frontend/app/page.tsx
  git commit -m "feat: global cross-document chat with source badges and clear"
  ```

---

## Chunk 4: Switch Text Model to DeepSeek V4 Flash

### Task 5: Update backend .env

**Files:**
- Modify: `backend/.env`

**Context:** Current `TEXT_*` vars (lines 8-10) point to DashScope (Qwen). DeepSeek uses an OpenAI-compatible API at `https://api.deepseek.com`. `ModelGateway` already reads these three vars — no code change needed.

- [ ] **Step 1: Verify the DeepSeek model ID**

  ```bash
  curl -s https://api.deepseek.com/models \
    -H "Authorization: Bearer $DEEPSEEK_API_KEY" | python3 -m json.tool | grep '"id"'
  ```

  Find the correct model ID for DeepSeek V4 Flash. If `deepseek-v4-flash` does not appear, use the closest available fast model (e.g., `deepseek-chat`).

- [ ] **Step 2: Update `backend/.env` lines 8-10**

  Change from:
  ```
  TEXT_API_KEY=$DASHSCOPE_API_KEY
  TEXT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
  TEXT_MODEL=qwen-plus-latest
  ```

  To:
  ```
  TEXT_API_KEY=$DEEPSEEK_API_KEY
  TEXT_BASE_URL=https://api.deepseek.com
  TEXT_MODEL=deepseek-v4-flash
  ```

  (Use the correct model ID found in Step 1.)

- [ ] **Step 3: Restart backend and smoke test**

  ```bash
  cd /Users/shihaochen/github/Teaching-Learning-/backend
  python -m uvicorn app.main:app --reload --port 18920
  ```

  Send a chat message in the app and verify a response arrives. Check backend logs — should show no "model not found" errors.

- [ ] **Step 4: Apply on production server**

  `.env` is gitignored — the change must also be applied on the production server directly. SSH in, update `backend/.env` with the same values, then restart the backend service.

---

## Final Verification

- [ ] Run TypeScript check across the full frontend:

  ```bash
  cd /Users/shihaochen/github/Teaching-Learning-/frontend && npx tsc --noEmit
  ```

- [ ] Confirm all 4 features work end-to-end:
  1. Navigate slides → thumbnail strip follows
  2. Hover slide image → explanation item highlights; click locks; Escape unlocks; ROI drag still works
  3. Switch to 全局 tab → messages from all docs load with source badges; clear works
  4. Chat response comes from DeepSeek (check backend logs for model name)

- [ ] Push to remote:

  ```bash
  git push
  ```
