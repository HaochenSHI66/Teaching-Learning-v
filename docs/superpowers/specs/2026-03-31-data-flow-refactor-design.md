# Data Flow Refactor Design

## Problem

`useUpload.ts` (800+ lines) maintains three unsynchronized caches for document data:
- React state (`cachedExplanations`)
- Memory refs (`slideCacheRef`, `explanationCacheRef`)
- IndexedDB (`localCache.ts`)

11 identified bugs including stale closures, race conditions, missing sync points, and silent data loss. Root cause: no single source of truth, each cache updated independently at 6+ code sites.

## Solution Overview

```
Backend (SQLite = single source of truth)
  ├─ Document.content_version — incremented on any slides/extracts/explanations change
  ├─ GET /api/v1/sync/manifest — returns { docId: version } for all user docs (~2KB)
  └─ POST /api/v1/sync/batch — returns full data for requested doc IDs (existing cache-batch, enhanced)

Frontend
  ├─ DocumentCacheManager (class, non-React)
  │     Single owner of: memory Map + IndexedDB reads/writes + sync logic
  │     Does NOT manage: library, sessions, loading, generation UI state
  ├─ useDocumentCache (hook) — React bridge via useSyncExternalStore
  ├─ usePreload (hook) — login sync + background refresh
  ├─ useDocumentActions (hook) — upload, delete, generate, move
  └─ useUpload (hook) — thin coordinator, composes the above
```

## Backend Changes

### 1. Document.content_version field

Add to `models.py`:
```python
class Document(SQLModel, table=True):
    content_version: int = Field(default=1)
```

Increment `content_version` in these code paths:
- `documents.py` `_upsert_slide_explanation()` — after writing explanation
- `documents.py` `_process_document_background()` — after processing slides/extracts
- `documents.py` `regenerate_document_explanations()` — after batch regeneration
- Any future path that modifies slides, extracts, or explanations

Implementation: helper function `bump_content_version(session, document_id)` called at each site.

### 2. Sync manifest endpoint

```
GET /api/v1/sync/manifest
Response: {
  "documents": {
    "8f2d4481-...": { "version": 5, "page_count": 58, "filename": "Introduction.pdf" },
    "6876ffd3-...": { "version": 3, "page_count": 46, "filename": "lecture7.pdf" }
  }
}
```

- Returns ALL documents for the authenticated user
- ~2KB payload, single query: `SELECT id, content_version, page_count, filename FROM document WHERE user_id = ?`
- Called once on login, response compared against local IndexedDB versions

### 3. Enhanced batch sync endpoint

Reuse existing `GET /api/v1/documents/cache-batch` (documents.py line 705). Add `content_version` to each returned document item so the client can store it.

Response shape (existing, add `content_version`):
```json
{
  "documents": [
    {
      "document_id": "...",
      "content_version": 5,
      "slides": [...],
      "explanations": [...]
    }
  ]
}
```

No new endpoint needed — manifest discovers diffs, existing batch endpoint fetches data.

### 4. No local JSON files

SQLite remains the single backend truth. No `storage/cache/*.json` layer. The manifest endpoint reads directly from the Document table.

## Frontend Changes

### 1. DocumentCacheManager (class)

New file: `frontend/lib/DocumentCacheManager.ts`

```typescript
type DocumentData = {
  slides: Slide[];
  explanations: SlideExplanation[];
  version: number;
};

type CacheListener = (docId: string) => void;

class DocumentCacheManager {
  private memory = new Map<string, DocumentData>();
  private versions = new Map<string, number>();  // docId → version
  private listeners = new Set<CacheListener>();
  private userId: string;  // IndexedDB isolation

  constructor(userId: string)

  // ── Read ──
  // Returns from memory. If not in memory, loads from IndexedDB into memory first.
  get(docId: string): DocumentData | undefined
  async getAsync(docId: string): Promise<DocumentData | undefined>  // memory → IndexedDB fallback

  has(docId: string): boolean
  getVersion(docId: string): number | undefined

  // ── Write ──
  // Updates memory + IndexedDB + notifies listeners. Single write path.
  async set(docId: string, data: DocumentData): Promise<void>

  // Update a single slide's explanation (after generation).
  // Merges into existing data, bumps nothing (version comes from server).
  async updateExplanation(docId: string, slideId: string, explanation: SlideExplanation): Promise<void>

  // ── Sync ──
  // Fetches manifest, compares versions, batch-fetches changed docs.
  async sync(manifest: Record<string, { version: number }>): Promise<string[]>  // returns updated docIds

  // ── Subscribe ──
  onChange(listener: CacheListener): () => void  // returns unsubscribe

  // ── Cleanup ──
  async clear(): Promise<void>
}
```

Key properties:
- **One write path**: `set()` and `updateExplanation()` are the only ways data enters the cache. Both update memory → IndexedDB → notify.
- **No React dependency**: Pure TypeScript class. Hooks subscribe via `onChange`.
- **User-isolated IndexedDB**: DB name is `tl-cache-{userId}`, preventing cross-account data leaks.
- **Synchronous reads**: `get()` reads from memory (fast). `getAsync()` falls back to IndexedDB if memory miss.
- **Error handling**: IndexedDB writes wrapped in try/catch with console.error. Memory always updated even if IndexedDB fails.

### 2. IndexedDB layer

Replace `localCache.ts` with internal implementation inside `DocumentCacheManager`:

```
IndexedDB: "tl-cache-{userId}"
  Store "documents": key = docId, value = { slides, explanations, version }
  Store "meta": key = "versions", value = { [docId]: version }
```

Single store per document (not separate slides/explanations stores). Atomic: one put = one document's complete data.

### 3. useDocumentCache hook

```typescript
function useDocumentCache(manager: DocumentCacheManager, docId: string | null) {
  // Uses useSyncExternalStore to subscribe to manager.onChange
  // Returns: { slides, explanations, isLoaded, version }
}
```

Why `useSyncExternalStore`: eliminates the React state ↔ ref desynchronization problem. The manager IS the external store. React reads from it directly, no intermediate state to go stale.

### 4. usePreload hook

```typescript
function usePreload(manager: DocumentCacheManager) {
  // On mount:
  //   1. Fetch manifest (GET /sync/manifest)
  //   2. Compare against manager.versions
  //   3. Batch-fetch changed docs (POST /sync/batch)
  //   4. manager.set() for each
  // Returns: { syncing: boolean, progress: { done: number, total: number } }
}
```

### 5. useDocumentActions hook

Contains: `handleUpload`, `deleteDocument`, `loadDocument`, `regenerateDocumentExplanations`, etc.

When explanation is generated:
```typescript
// After API returns new explanation:
await manager.updateExplanation(docId, slideId, result);
// That's it. Manager handles memory + IndexedDB + listener notification.
// React state updates automatically via useSyncExternalStore.
```

### 6. useUpload hook (thin coordinator)

```typescript
function useUpload() {
  const manager = useRef(new DocumentCacheManager(userId));
  const cache = useDocumentCache(manager.current, documentId);
  const preload = usePreload(manager.current);
  const actions = useDocumentActions(manager.current);

  return { ...cache, ...preload, ...actions, /* library, loading, etc. */ };
}
```

Exposes the same interface as current useUpload to minimize page.tsx changes.

## Sync Flow

```
Login → bootstrap (folders + first doc slides) → show UI immediately
  ↓ (background)
Fetch manifest → compare versions → batch-fetch changed docs → update cache
  ↓
User generates explanation → API saves to DB + bumps content_version
  → frontend calls manager.updateExplanation() → memory + IndexedDB + React updated
  ↓
Next login → manifest shows bumped version → batch-fetch only changed docs
```

## Bugs Fixed

| # | Bug | How Fixed |
|---|---|---|
| 1,7 | Stale closure documentId | Class uses `this`, no closures |
| 2 | Memory cache not synced after generation | Single `updateExplanation()` method |
| 3 | Auto-gen checks wrong state | Reads from manager.get(), always consistent |
| 4 | React state vs ref desync | useSyncExternalStore, no separate ref |
| 5 | Fire-and-forget IndexedDB | try/catch in manager.set() |
| 6 | hasFullCachedDocument wrong | Version-based check, not content inspection |
| 8 | No data validation | Version number from server = trust boundary |
| 9 | Preload doesn't update state | manager.onChange notifies all subscribers |
| 10 | IndexedDB transaction isolation | One put per document, atomic |
| 11 | Missing sort | manager.set() sorts explanations internally |

## Migration

- `useUpload` return type stays the same → page.tsx changes minimal
- Old `localCache.ts` deleted
- Old `slideCacheRef`/`explanationCacheRef`/`cachedExplanations` state removed from useUpload
- bootstrap.py kept as-is (fast first load)
- cache-batch endpoint enhanced with content_version field

## Files Changed

| File | Change |
|---|---|
| `backend/app/models.py` | Add `content_version` to Document |
| `backend/app/api/documents.py` | `bump_content_version()` helper, add version to cache-batch response |
| `backend/app/api/sync.py` | New — manifest endpoint |
| `frontend/lib/DocumentCacheManager.ts` | New — cache manager class |
| `frontend/hooks/useDocumentCache.ts` | New — React bridge hook |
| `frontend/hooks/usePreload.ts` | New — sync + preload hook |
| `frontend/hooks/useDocumentActions.ts` | New — upload/delete/generate |
| `frontend/hooks/useUpload.ts` | Rewrite — thin coordinator (~80 lines) |
| `frontend/lib/localCache.ts` | Delete |
| `frontend/lib/api.ts` | Add sync manifest API, enhance cache-batch types |
