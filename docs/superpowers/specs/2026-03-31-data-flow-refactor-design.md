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
  ├─ Document.content_version — composite version (see Versioning section)
  ├─ GET /api/v1/sync/manifest — returns { docId: { version, schema_version } } (~2KB)
  └─ GET /api/v1/documents/cache-batch — returns full data for requested doc IDs (enhanced)

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

### 1. Composite versioning

Add to `models.py`:
```python
class Document(SQLModel, table=True):
    content_version: int = Field(default=1)  # bumped on any data change
```

`content_version` is bumped when:
- Any slide explanation is written or updated (`_upsert_slide_explanation()`)
- Document is processed (`_process_document_background()`)
- Batch regeneration completes (`regenerate_document_explanations()`)

Implementation: `bump_content_version(session, document_id)` helper.

**Schema version handling**: The manifest also includes the server's current global schema versions (`CURRENT_EXPLANATION_VERSION`, `CURRENT_EXTRACT_SCHEMA_VERSION`). When these globals change (code deploy), the client treats ALL documents as stale regardless of `content_version`, because the server's `explanation_state` logic will mark old-version explanations as `not_generated`.

On schema version upgrade, the backend should also run a migration to bump `content_version` for all affected documents:
```python
# In app startup or migration script:
if explanation_version_changed:
    session.exec(update(Document).values(content_version=Document.content_version + 1))
```

### 2. Sync manifest endpoint

New file: `backend/app/api/sync.py`

```
GET /api/v1/sync/manifest
Response: {
  "schema": {
    "explanation_version": 4,
    "extract_version": 3
  },
  "documents": {
    "8f2d4481-...": { "version": 5, "page_count": 58, "filename": "Introduction.pdf" },
    "6876ffd3-...": { "version": 3, "page_count": 46, "filename": "lecture7.pdf" }
  }
}
```

- Returns ALL documents for the authenticated user
- ~2KB payload, single query
- Called once on login

Client sync logic:
1. If `schema.explanation_version` or `schema.extract_version` differs from locally stored schema versions → treat ALL docs as changed
2. Otherwise, compare per-document `version` against local IndexedDB versions
3. Documents in local IndexedDB but NOT in manifest → **delete from local** (user deleted them server-side)

### 3. Enhanced batch sync endpoint

Reuse existing `GET /api/v1/documents/cache-batch`. Add `content_version` to response:

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

### 4. Mutation responses include new version

All endpoints that modify document content must return the new `content_version`:
- `POST .../explanations/generate` → response includes `content_version`
- `POST .../slides/.../explanations/generate` → response includes `content_version`

This lets the client update its local version immediately after a mutation, without needing to re-fetch the manifest.

### 5. Bootstrap enhanced

Add `content_version` to bootstrap's `first_document`:
```json
{
  "folders": { ... },
  "first_document": {
    "document_id": "...",
    "content_version": 5,
    "slides": [...]
  }
}
```

This prevents the first document from being re-fetched during manifest sync, because the client can store its version from bootstrap.

### 6. No local JSON files

SQLite remains the single backend truth. No `storage/cache/*.json` layer.

## Frontend Changes

### 1. DocumentCacheManager (class)

New file: `frontend/lib/DocumentCacheManager.ts`

```typescript
type DocumentData = {
  slides: Slide[];
  explanations: SlideExplanation[];
  version: number;
};

type CacheListener = (docId: string, event: "update" | "delete") => void;

class DocumentCacheManager {
  private memory = new Map<string, DocumentData>();
  private listeners = new Set<CacheListener>();
  private userId: string;
  private schemaVersion = { explanation: 0, extract: 0 };

  constructor(userId: string)

  // ── Read (synchronous, memory only) ──
  get(docId: string): DocumentData | undefined
  has(docId: string): boolean
  getVersion(docId: string): number | undefined

  // ── Hydrate (async, loads IndexedDB → memory) ──
  // Must be called before get() will return data for a doc.
  // Called during bootstrap/sync, NOT by get() implicitly.
  async hydrate(docId: string): Promise<DocumentData | undefined>
  async hydrateAll(): Promise<void>  // loads all IndexedDB entries into memory

  // ── Write (updates memory + IndexedDB + notifies) ──
  async set(docId: string, data: DocumentData): Promise<void>
  async updateExplanation(docId: string, slideId: string, explanation: SlideExplanation): Promise<void>
  async delete(docId: string): Promise<void>

  // ── Sync ──
  // Takes manifest from server. Returns { updated, removed, unchanged }.
  // - updated: docs whose version changed → caller should batch-fetch these
  // - removed: docs in local but not in manifest → deleted from memory + IDB
  // - unchanged: docs with matching version → no action
  async diffManifest(manifest: SyncManifest): Promise<SyncDiff>

  // After batch-fetch completes, call set() for each updated doc.
  // After diffManifest returns removed docs, they are already deleted.

  // ── Subscribe ──
  onChange(listener: CacheListener): () => void

  // ── Schema ──
  setSchemaVersion(explanation: number, extract: number): void
  isSchemaChanged(serverSchema: { explanation: number; extract: number }): boolean

  // ── Cleanup ──
  async clear(): Promise<void>
}
```

**Key contracts**:
- `get()` is **purely synchronous**, reads only from memory. Returns `undefined` if not hydrated.
- `hydrate()` / `hydrateAll()` is the **async load path**: IndexedDB → memory. Called explicitly during startup, never implicitly by `get()`.
- `useSyncExternalStore` calls `get()` in its snapshot function (synchronous). The hook calls `hydrate()` in a `useEffect` to populate memory.
- `set()` is the **single write path**: sorts explanations by page_num, updates memory, writes to IndexedDB (with try/catch + console.error), notifies listeners.
- `delete()` removes from memory + IndexedDB + notifies with `"delete"` event.
- `diffManifest()` handles the three-way comparison: updated / removed / unchanged. Removed docs are deleted immediately from local cache.

### 2. IndexedDB layer

Internal to `DocumentCacheManager`. Not a separate file.

```
IndexedDB: "tl-cache-{userId}"
  Store "documents": key = docId, value = { slides, explanations, version }
  Store "meta": key = "schema", value = { explanation: 4, extract: 3 }
```

Single store per document. Atomic: one `put` = one document's complete data.

### 3. useDocumentCache hook

```typescript
function useDocumentCache(manager: DocumentCacheManager, docId: string | null) {
  // useSyncExternalStore:
  //   subscribe: manager.onChange
  //   getSnapshot: () => manager.get(docId)
  //
  // useEffect: when docId changes, call manager.hydrate(docId) if not already in memory
  //
  // Returns: { slides, explanations, isLoaded, version }
}
```

The `hydrate` call is the only async operation. Once hydrated, all reads are synchronous through `get()`.

### 4. usePreload hook

```typescript
function usePreload(manager: DocumentCacheManager) {
  // On mount:
  //   1. manager.hydrateAll() — load IndexedDB → memory
  //   2. Fetch manifest (GET /sync/manifest)
  //   3. Check schema version change
  //   4. manager.diffManifest(manifest) → { updated, removed }
  //   5. Batch-fetch updated docs via cache-batch (in chunks of 4)
  //   6. manager.set() for each fetched doc
  // Returns: { syncing: boolean, progress: { done: number, total: number } }
}
```

### 5. useDocumentActions hook

Contains: `handleUpload`, `deleteDocument`, `loadDocument`, `regenerateDocumentExplanations`, etc.

When explanation is generated:
```typescript
const result = await generateSlideExplanation(docId, slideId);
// API response includes new content_version
await manager.updateExplanation(docId, slideId, result);
// If API returned content_version, update it:
await manager.setVersion(docId, result.content_version);
// Done. Memory + IndexedDB + React all updated via single path.
```

When document is deleted:
```typescript
await deleteDocumentApi(docId);
await manager.delete(docId);  // removes from memory + IndexedDB + notifies
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
Login → bootstrap (folders + first doc slides + content_version) → show UI
  ↓ (background)
hydrateAll() — load IndexedDB → memory (instant, no network)
  ↓
Fetch manifest → check schema change → diffManifest()
  ↓
  ├─ Schema changed? → ALL docs marked as updated
  ├─ Per-doc version differs? → marked as updated
  └─ Local doc not in manifest? → deleted from local
  ↓
Batch-fetch updated docs → manager.set() for each → React auto-updates
  ↓
User generates explanation → API returns new content_version
  → manager.updateExplanation() + setVersion() → memory + IDB + React
  ↓
Next login → manifest shows bumped versions → only fetch changed docs
```

## Bugs Fixed

| # | Bug | How Fixed |
|---|---|---|
| 1,7 | Stale closure documentId | Class uses `this`, no closures |
| 2 | Memory cache not synced after generation | Single `updateExplanation()` method |
| 3 | Auto-gen checks wrong state | Reads from manager.get(), always consistent |
| 4 | React state vs ref desync | useSyncExternalStore, no separate ref |
| 5 | Fire-and-forget IndexedDB | try/catch in manager.set() |
| 6 | hasFullCachedDocument wrong | Version-based check via diffManifest |
| 8 | No data validation | Version from server = trust boundary |
| 9 | Preload doesn't update state | manager.onChange notifies all subscribers |
| 10 | IndexedDB transaction isolation | One put per document, atomic |
| 11 | Missing sort | manager.set() sorts explanations internally |
| NEW | Schema version upgrade leaves stale cache | manifest includes schema versions, triggers full re-sync |
| NEW | Deleted docs linger in local cache | diffManifest removes docs not in manifest |
| NEW | Bootstrap first doc re-fetched during sync | bootstrap includes content_version |

## Testing

### Required test cases

1. **Schema version upgrade**: Change `CURRENT_EXPLANATION_VERSION`, verify all local docs are re-synced on next login
2. **Document deletion**: Delete a doc server-side, verify it's removed from IndexedDB on next sync
3. **Bootstrap not re-fetched**: Login, verify first doc is NOT in the batch-fetch list (already has correct version from bootstrap)
4. **Multi-account isolation**: Login as user A, switch to user B, verify user A's cache is not visible to user B
5. **Explanation generation sync**: Generate explanation, verify IndexedDB + memory + React state all updated, verify version bumped
6. **Offline resilience**: IndexedDB write fails (simulate), verify memory still works, verify error is logged

## Migration

- `useUpload` return type stays the same → page.tsx changes minimal
- Old `localCache.ts` deleted
- Old `slideCacheRef`/`explanationCacheRef`/`cachedExplanations` state removed from useUpload
- bootstrap.py enhanced with `content_version` in first_document
- cache-batch endpoint enhanced with `content_version` field
- New `content_version` column added to Document table (default=1, migration)

## Files Changed

| File | Change |
|---|---|
| `backend/app/models.py` | Add `content_version` to Document |
| `backend/app/api/documents.py` | `bump_content_version()` helper, add version to cache-batch + generate responses |
| `backend/app/api/sync.py` | New — manifest endpoint |
| `backend/app/api/bootstrap.py` | Add `content_version` to first_document |
| `frontend/lib/DocumentCacheManager.ts` | New — cache manager class |
| `frontend/hooks/useDocumentCache.ts` | New — React bridge hook |
| `frontend/hooks/usePreload.ts` | New — sync + preload hook |
| `frontend/hooks/useDocumentActions.ts` | New — upload/delete/generate |
| `frontend/hooks/useUpload.ts` | Rewrite — thin coordinator (~80 lines) |
| `frontend/lib/localCache.ts` | Delete |
| `frontend/lib/api.ts` | Add sync manifest API, enhance cache-batch types |
