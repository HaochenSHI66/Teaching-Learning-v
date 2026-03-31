# Data Flow Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-layer unsynchronized cache (React state / memory refs / IndexedDB) with a single `DocumentCacheManager` class as source of truth, version-based sync via manifest endpoint, and clean hook decomposition.

**Architecture:** `DocumentCacheManager` (pure TS class) owns all document data in memory + IndexedDB. React hooks subscribe via `useSyncExternalStore`. Backend gains `content_version` on Document model and a `/sync/manifest` endpoint. Existing `cache-batch` is enhanced with version info. Bootstrap includes `content_version`.

**Tech Stack:** Python/FastAPI, SQLModel, TypeScript, React 19, IndexedDB, `useSyncExternalStore`

**Spec:** `docs/superpowers/specs/2026-03-31-data-flow-refactor-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/app/models.py` | Modify | Add `content_version` field to Document |
| `backend/app/api/sync.py` | Create | `GET /api/v1/sync/manifest` endpoint |
| `backend/app/api/documents.py` | Modify | `bump_content_version()` helper, add `content_version` to cache-batch + generate responses |
| `backend/app/api/bootstrap.py` | Modify | Add `content_version` to BootstrapFirstDocument |
| `backend/app/schemas.py` | Modify | Add `content_version` to DocumentCacheBundleRead, SlideExplanationGenerateResponse |
| `backend/app/main.py` | Modify | Register sync_router |
| `backend/tests/test_sync.py` | Create | Tests for manifest + version bumping |
| `frontend/lib/DocumentCacheManager.ts` | Create | Cache manager class (memory + IDB + subscribe) |
| `frontend/hooks/useDocumentCache.ts` | Create | React bridge via useSyncExternalStore |
| `frontend/hooks/usePreload.ts` | Create | Manifest sync + background preload |
| `frontend/hooks/useDocumentActions.ts` | Create | Upload, delete, generate, move |
| `frontend/hooks/useUpload.ts` | Rewrite | Thin coordinator (~80 lines) |
| `frontend/lib/localCache.ts` | Delete | Replaced by DocumentCacheManager internal IDB |
| `frontend/lib/api.ts` | Modify | Add sync manifest API, update types |
| `frontend/app/page.tsx` | Modify | Adapt to new useUpload interface (minimal) |

---

## Task 1: Backend — Add `content_version` to Document model

**Files:**
- Modify: `backend/app/models.py:28-38`
- Create: `backend/tests/test_sync.py`

- [ ] **Step 1: Write failing test for content_version field**

```python
# backend/tests/test_sync.py
from app.models import Document

def test_document_has_content_version():
    doc = Document(filename="test.pdf", media_type="application/pdf", storage_path="/tmp")
    assert hasattr(doc, "content_version")
    assert doc.content_version == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_sync.py::test_document_has_content_version -v`
Expected: FAIL — `AttributeError: 'Document' object has no attribute 'content_version'`

- [ ] **Step 3: Add content_version to Document model**

In `backend/app/models.py`, add to the Document class (after `created_at`):
```python
    content_version: int = Field(default=1)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_sync.py::test_document_has_content_version -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_sync.py
git commit -m "feat(backend): add content_version field to Document model"
```

---

## Task 2: Backend — `bump_content_version` helper + wire into mutation paths

**Files:**
- Modify: `backend/app/api/documents.py:382-437` (after `_upsert_slide_explanation`)
- Modify: `backend/tests/test_sync.py`

- [ ] **Step 1: Write failing test for bump helper**

```python
# backend/tests/test_sync.py (append)
from app.api.documents import bump_content_version
from sqlmodel import Session

def test_bump_content_version(db_session: Session):
    """Version should increment by 1 each call."""
    from app.models import Document
    doc = Document(filename="test.pdf", media_type="application/pdf", storage_path="/tmp", user_id="u1")
    db_session.add(doc)
    db_session.commit()
    assert doc.content_version == 1

    bump_content_version(db_session, doc.id)
    db_session.refresh(doc)
    assert doc.content_version == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_sync.py::test_bump_content_version -v`
Expected: FAIL — `ImportError: cannot import name 'bump_content_version'`

- [ ] **Step 3: Implement bump_content_version**

Add at the top of `backend/app/api/documents.py` (after imports, before first function):
```python
def bump_content_version(session: Session, document_id: str) -> None:
    """Increment document's content_version. Call after any slides/extracts/explanations change."""
    document = session.get(Document, document_id)
    if document:
        document.content_version = (document.content_version or 0) + 1
        session.add(document)
```

- [ ] **Step 4: Wire into mutation paths**

Add `bump_content_version(session, document_id)` call in these locations:

1. `_upsert_slide_explanation()` — after line ~431 (after `session.add(explanation)`):
```python
    bump_content_version(session, document_id)
```

2. `_process_document_background()` — after line ~228 (after slides committed):
```python
    bump_content_version(session, document_id)
```

3. `regenerate_document_explanations()` — after each slide commit inside the loop (after line ~929):
Already covered by `_upsert_slide_explanation` call within the loop.

- [ ] **Step 5: Run tests**

Run: `cd backend && python -m pytest tests/test_sync.py -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/documents.py backend/tests/test_sync.py
git commit -m "feat(backend): bump_content_version helper wired into mutation paths"
```

---

## Task 3: Backend — Sync manifest endpoint

**Files:**
- Create: `backend/app/api/sync.py`
- Modify: `backend/app/main.py:79-97`
- Modify: `backend/tests/test_sync.py`

- [ ] **Step 1: Write failing test for manifest endpoint**

```python
# backend/tests/test_sync.py (append)
from fastapi.testclient import TestClient

def test_sync_manifest_returns_documents(client: TestClient, auth_headers: dict):
    """Manifest should list all documents with version, page_count, filename."""
    resp = client.get("/api/v1/sync/manifest", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "schema" in data
    assert "explanation_version" in data["schema"]
    assert "extract_version" in data["schema"]
    assert "documents" in data
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — 404 (endpoint doesn't exist)

- [ ] **Step 3: Create sync.py**

```python
# backend/app/api/sync.py
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.auth import get_current_user
from app.models import Document, User
from app.services.explanation_engine import CURRENT_EXPLANATION_VERSION
from app.services.slide_processor import CURRENT_EXTRACT_SCHEMA_VERSION

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


class ManifestDocumentInfo(BaseModel):
    version: int
    page_count: int
    filename: str


class SyncManifestResponse(BaseModel):
    schema_: dict = {}  # renamed to avoid pydantic conflict
    documents: dict[str, ManifestDocumentInfo]

    class Config:
        # Allow "schema" as field name in JSON output
        populate_by_name = True

    def model_dump(self, **kwargs):
        d = super().model_dump(**kwargs)
        d["schema"] = d.pop("schema_", {})
        return d


@router.get("/manifest")
def get_sync_manifest(
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    documents = session.exec(
        select(Document).where(Document.user_id == current_user.id)
    ).all()

    return {
        "schema": {
            "explanation_version": CURRENT_EXPLANATION_VERSION,
            "extract_version": CURRENT_EXTRACT_SCHEMA_VERSION,
        },
        "documents": {
            doc.id: {
                "version": doc.content_version or 1,
                "page_count": doc.page_count,
                "filename": doc.filename,
            }
            for doc in documents
        },
    }
```

- [ ] **Step 4: Register router in main.py**

Add to `backend/app/main.py` imports:
```python
from app.api.sync import router as sync_router
```

Add to router includes (after bootstrap_router):
```python
    app.include_router(sync_router)
```

- [ ] **Step 5: Run tests**

Run: `cd backend && python -m pytest tests/test_sync.py -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/sync.py backend/app/main.py backend/tests/test_sync.py
git commit -m "feat(backend): add /api/v1/sync/manifest endpoint"
```

---

## Task 4: Backend — Add content_version to cache-batch + bootstrap + generate responses

**Files:**
- Modify: `backend/app/schemas.py:179-186`
- Modify: `backend/app/api/documents.py:705-752` (cache-batch)
- Modify: `backend/app/api/documents.py:832-878` (regenerate_slide_explanation response)
- Modify: `backend/app/api/bootstrap.py:44-46`

- [ ] **Step 1: Add content_version to schemas**

In `backend/app/schemas.py`, add `content_version` to `DocumentCacheBundleRead`:
```python
class DocumentCacheBundleRead(BaseModel):
    document_id: str
    content_version: int
    slides: list[SlideRead]
    explanations: list[SlideExplanationRead]
```

Add `content_version` to `SlideExplanationGenerateResponse` (find it and add):
```python
class SlideExplanationGenerateResponse(BaseModel):
    # ... existing fields ...
    content_version: int | None = None
```

- [ ] **Step 2: Update cache-batch to include content_version**

In `backend/app/api/documents.py` `get_document_cache_batch()`, where bundles are built (around line 735-750), add:
```python
content_version=document.content_version or 1,
```
to the `DocumentCacheBundleRead` construction.

- [ ] **Step 3: Update regenerate_slide_explanation to return content_version**

In the return statement of `regenerate_slide_explanation()` (around line 875), add:
```python
content_version=document.content_version,
```

- [ ] **Step 4: Update bootstrap to include content_version**

In `backend/app/api/bootstrap.py`:

Add `content_version: int` to `BootstrapFirstDocument`:
```python
class BootstrapFirstDocument(BaseModel):
    document_id: str
    content_version: int
    slides: list[BootstrapSlide]
```

Where `first_document` is built (around line 113), add:
```python
first_document = BootstrapFirstDocument(
    document_id=first_doc_id,
    content_version=document.content_version or 1,
    slides=slides,
)
```

- [ ] **Step 5: Run existing tests**

Run: `cd backend && python -m pytest tests/ -v`
Expected: ALL PASS (backward compatible — content_version is optional in some places)

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas.py backend/app/api/documents.py backend/app/api/bootstrap.py
git commit -m "feat(backend): add content_version to cache-batch, bootstrap, and generate responses"
```

---

## Task 5: Frontend — DocumentCacheManager class

**Files:**
- Create: `frontend/lib/DocumentCacheManager.ts`

This is the core of the refactor. The class manages memory cache + IndexedDB + listener notifications.

- [ ] **Step 1: Create DocumentCacheManager.ts**

```typescript
// frontend/lib/DocumentCacheManager.ts
"use client";

import type { Slide, SlideExplanation } from "@/lib/api";

export type DocumentData = {
  slides: Slide[];
  explanations: SlideExplanation[];
  version: number;
};

export type CacheEvent = "update" | "delete";
export type CacheListener = (docId: string, event: CacheEvent) => void;

export type SyncManifest = {
  schema: { explanation_version: number; extract_version: number };
  documents: Record<string, { version: number; page_count: number; filename: string }>;
};

export type SyncDiff = {
  updated: string[];   // docIds that need re-fetch
  removed: string[];   // docIds removed from local
  unchanged: string[]; // docIds with matching version
};

// ── IndexedDB helpers (internal) ──

const DB_VERSION = 1;
const STORE_DOCS = "documents";
const STORE_META = "meta";

function dbName(userId: string): string {
  return `tl-cache-${userId}`;
}

function openDB(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(userId), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOCS)) db.createObjectStore(STORE_DOCS);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(userId: string, store: string, key: string): Promise<T | undefined> {
  try {
    const db = await openDB(userId);
    return new Promise((resolve) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function idbPut(userId: string, store: string, key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB(userId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error(`[DocumentCacheManager] IDB put failed (${store}/${key}):`, err);
  }
}

async function idbDelete(userId: string, store: string, key: string): Promise<void> {
  try {
    const db = await openDB(userId);
    return new Promise((resolve) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

async function idbGetAllKeys(userId: string, store: string): Promise<string[]> {
  try {
    const db = await openDB(userId);
    return new Promise((resolve) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function idbClear(userId: string): Promise<void> {
  try {
    const db = await openDB(userId);
    const tx = db.transaction([STORE_DOCS, STORE_META], "readwrite");
    tx.objectStore(STORE_DOCS).clear();
    tx.objectStore(STORE_META).clear();
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
  } catch {
    // ignore
  }
}

// ── DocumentCacheManager ──

export class DocumentCacheManager {
  private memory = new Map<string, DocumentData>();
  private listeners = new Set<CacheListener>();
  private localSchema = { explanation: 0, extract: 0 };
  readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  // ── Read (synchronous, memory only) ──

  get(docId: string): DocumentData | undefined {
    return this.memory.get(docId);
  }

  has(docId: string): boolean {
    return this.memory.has(docId);
  }

  getVersion(docId: string): number | undefined {
    return this.memory.get(docId)?.version;
  }

  /** Returns a snapshot object for useSyncExternalStore. */
  getSnapshot(): ReadonlyMap<string, DocumentData> {
    return this.memory;
  }

  // ── Hydrate (async: IndexedDB → memory) ──

  async hydrate(docId: string): Promise<DocumentData | undefined> {
    if (this.memory.has(docId)) return this.memory.get(docId);
    const stored = await idbGet<DocumentData>(this.userId, STORE_DOCS, docId);
    if (stored) {
      this.memory.set(docId, stored);
      this.notify(docId, "update");
    }
    return stored;
  }

  async hydrateAll(): Promise<void> {
    const keys = await idbGetAllKeys(this.userId, STORE_DOCS);
    await Promise.all(keys.map((key) => this.hydrate(key)));
    // Restore schema version from meta
    const savedSchema = await idbGet<{ explanation: number; extract: number }>(
      this.userId, STORE_META, "schema"
    );
    if (savedSchema) {
      this.localSchema = savedSchema;
    }
  }

  // ── Write (memory + IndexedDB + notify) ──

  async set(docId: string, data: DocumentData): Promise<void> {
    // Sort explanations by page_num for consistency
    const sorted: DocumentData = {
      ...data,
      explanations: [...data.explanations].sort((a, b) => a.page_num - b.page_num),
    };
    this.memory.set(docId, sorted);
    this.notify(docId, "update");
    await idbPut(this.userId, STORE_DOCS, docId, sorted);
  }

  /**
   * Atomic single-slide update after explanation generation.
   * Updates explanation list + slide's explanation_state + version in one shot.
   *
   * On failure path, pass the existing explanation (or null to leave unchanged)
   * and slideState="error". This will NOT overwrite existing explanation content
   * if explanation is null.
   */
  async updateExplanation(docId: string, params: {
    slideId: string;
    explanation: SlideExplanation | null;
    slideState: "ready" | "error" | "not_generated";
    contentVersion: number;
  }): Promise<void> {
    const existing = this.memory.get(docId);
    if (!existing) return;

    // Update explanations list
    let nextExplanations = existing.explanations;
    if (params.explanation) {
      nextExplanations = [
        ...existing.explanations.filter((e) => e.slide_id !== params.slideId),
        params.explanation,
      ].sort((a, b) => a.page_num - b.page_num);
    }

    // Update slide's explanation_state
    const nextSlides = existing.slides.map((s) =>
      s.id === params.slideId
        ? { ...s, explanation_state: params.slideState }
        : s,
    );

    const nextData: DocumentData = {
      slides: nextSlides,
      explanations: nextExplanations,
      version: params.contentVersion,
    };

    this.memory.set(docId, nextData);
    this.notify(docId, "update");
    await idbPut(this.userId, STORE_DOCS, docId, nextData);
  }

  async delete(docId: string): Promise<void> {
    this.memory.delete(docId);
    this.notify(docId, "delete");
    await idbDelete(this.userId, STORE_DOCS, docId);
  }

  // ── Sync ──

  isSchemaChanged(serverSchema: { explanation_version: number; extract_version: number }): boolean {
    return (
      serverSchema.explanation_version !== this.localSchema.explanation ||
      serverSchema.extract_version !== this.localSchema.extract
    );
  }

  async saveSchemaVersion(schema: { explanation_version: number; extract_version: number }): Promise<void> {
    this.localSchema = { explanation: schema.explanation_version, extract: schema.extract_version };
    await idbPut(this.userId, STORE_META, "schema", this.localSchema);
  }

  /**
   * Compare server manifest against local cache.
   * Returns which docs need fetching, which are unchanged, which should be deleted.
   * Deleted docs are removed from memory + IDB immediately.
   */
  async diffManifest(manifest: SyncManifest): Promise<SyncDiff> {
    const schemaChanged = this.isSchemaChanged(manifest.schema);
    const serverDocIds = new Set(Object.keys(manifest.documents));

    const updated: string[] = [];
    const unchanged: string[] = [];
    const removed: string[] = [];

    // Check server docs against local
    for (const [docId, info] of Object.entries(manifest.documents)) {
      const localVersion = this.getVersion(docId);
      if (schemaChanged || localVersion === undefined || localVersion !== info.version) {
        updated.push(docId);
      } else {
        unchanged.push(docId);
      }
    }

    // Find local docs not in server manifest → deleted
    for (const docId of this.memory.keys()) {
      if (!serverDocIds.has(docId)) {
        removed.push(docId);
      }
    }
    // Also check IDB keys not in memory
    const idbKeys = await idbGetAllKeys(this.userId, STORE_DOCS);
    for (const key of idbKeys) {
      if (!serverDocIds.has(key) && !removed.includes(key)) {
        removed.push(key);
      }
    }

    // Delete removed docs immediately
    for (const docId of removed) {
      await this.delete(docId);
    }

    // Save new schema version
    await this.saveSchemaVersion(manifest.schema);

    return { updated, removed, unchanged };
  }

  // ── Subscribe ──

  onChange(listener: CacheListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(docId: string, event: CacheEvent): void {
    for (const listener of this.listeners) {
      try { listener(docId, event); } catch { /* ignore */ }
    }
  }

  // ── Cleanup ──

  async clear(): Promise<void> {
    this.memory.clear();
    await idbClear(this.userId);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit lib/DocumentCacheManager.ts` (or just `npx next build`)
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/DocumentCacheManager.ts
git commit -m "feat(frontend): add DocumentCacheManager class"
```

---

## Task 6: Frontend — useDocumentCache hook (React bridge)

**Files:**
- Create: `frontend/hooks/useDocumentCache.ts`

- [ ] **Step 1: Create useDocumentCache.ts**

```typescript
// frontend/hooks/useDocumentCache.ts
"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { DocumentCacheManager, DocumentData } from "@/lib/DocumentCacheManager";

/**
 * React bridge to DocumentCacheManager via useSyncExternalStore.
 * Provides synchronous reads from the manager's memory cache.
 * Triggers hydrate from IndexedDB when docId changes.
 */
export function useDocumentCache(
  manager: DocumentCacheManager | null,
  docId: string | null,
) {
  // Subscribe to manager changes
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!manager) return () => {};
      return manager.onChange(() => onStoreChange());
    },
    [manager],
  );

  // Snapshot: read current doc data from memory (synchronous)
  const getSnapshot = useCallback(() => {
    if (!manager || !docId) return undefined;
    return manager.get(docId);
  }, [manager, docId]);

  const data = useSyncExternalStore(subscribe, getSnapshot, () => undefined);

  // Hydrate from IndexedDB when docId changes
  useEffect(() => {
    if (!manager || !docId) return;
    if (!manager.has(docId)) {
      void manager.hydrate(docId);
    }
  }, [manager, docId]);

  return useMemo(
    () => ({
      slides: data?.slides ?? [],
      explanations: data?.explanations ?? [],
      version: data?.version ?? 0,
      isLoaded: data !== undefined,
      // Convenience: explanations keyed by slide_id (for page.tsx compatibility)
      explanationsBySlideId: Object.fromEntries(
        (data?.explanations ?? []).map((e) => [e.slide_id, e]),
      ) as Record<string, import("@/lib/api").SlideExplanation>,
    }),
    [data],
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx next build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/useDocumentCache.ts
git commit -m "feat(frontend): add useDocumentCache hook with useSyncExternalStore"
```

---

## Task 7: Frontend — API additions (manifest + enhanced types)

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add sync manifest API function and update types**

Add to `frontend/lib/api.ts`:

```typescript
// ── Sync manifest ──
export type SyncManifestResponse = {
  schema: { explanation_version: number; extract_version: number };
  documents: Record<string, { version: number; page_count: number; filename: string }>;
};

export async function fetchSyncManifest(): Promise<SyncManifestResponse> {
  return request<SyncManifestResponse>("/api/v1/sync/manifest");
}
```

Update `BootstrapData` type to include `content_version`:
```typescript
export type BootstrapData = {
  folders: DocumentLibrary;
  first_document: {
    document_id: string;
    content_version: number;
    slides: Slide[];
  } | null;
};
```

Update `DocumentCacheBatchPayload` (or whatever the current type name is) to include `content_version`:
```typescript
// In the cache batch payload type, add content_version to each document item
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx next build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat(frontend): add sync manifest API and content_version types"
```

---

## Task 8: Frontend — usePreload hook

**Files:**
- Create: `frontend/hooks/usePreload.ts`

- [ ] **Step 1: Create usePreload.ts**

```typescript
// frontend/hooks/usePreload.ts
"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentCacheManager } from "@/lib/DocumentCacheManager";
import { fetchSyncManifest, fetchDocumentCacheBatch } from "@/lib/api";

const BATCH_SIZE = 4;

export function usePreload(manager: DocumentCacheManager | null) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const runRef = useRef(0);

  useEffect(() => {
    if (!manager) return;
    const runId = ++runRef.current;

    void (async () => {
      setSyncing(true);
      try {
        // 1. Hydrate memory from IndexedDB
        await manager.hydrateAll();

        // 2. Fetch manifest
        const manifest = await fetchSyncManifest();

        if (runRef.current !== runId) return;

        // 3. Diff against local
        const diff = await manager.diffManifest(manifest);

        if (diff.updated.length === 0) {
          setSyncing(false);
          return;
        }

        // 4. Batch-fetch changed docs
        setProgress({ done: 0, total: diff.updated.length });
        const batches: string[][] = [];
        for (let i = 0; i < diff.updated.length; i += BATCH_SIZE) {
          batches.push(diff.updated.slice(i, i + BATCH_SIZE));
        }

        let done = 0;
        for (const batch of batches) {
          if (runRef.current !== runId) return;
          try {
            const payload = await fetchDocumentCacheBatch(batch);
            for (const item of payload.documents) {
              await manager.set(item.document_id, {
                slides: item.slides,
                explanations: item.explanations,
                version: (item as any).content_version ?? 0,
              });
            }
            done += batch.length;
            setProgress({ done, total: diff.updated.length });
          } catch (err) {
            console.error("[usePreload] batch failed:", err);
            done += batch.length;
            setProgress({ done, total: diff.updated.length });
          }
        }
      } catch (err) {
        console.error("[usePreload] sync failed:", err);
      } finally {
        if (runRef.current === runId) setSyncing(false);
      }
    })();
  }, [manager]);

  return { syncing, progress };
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx next build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/usePreload.ts
git commit -m "feat(frontend): add usePreload hook for manifest-based sync"
```

---

## Task 9: Frontend — useDocumentActions hook

**Files:**
- Create: `frontend/hooks/useDocumentActions.ts`

This hook contains all the document mutation logic: upload, delete, load, generate, move. It replaces the corresponding functions in the current `useUpload.ts`.

- [ ] **Step 1: Create useDocumentActions.ts**

This is a large file (~250 lines). It should contain:
- `handleUpload(file, folderId)` — upload file, poll for processing, add to cache when ready
- `loadDocument(documentId)` — set as current doc, hydrate from cache or fetch
- `deleteDocument(documentId)` — API delete + manager.delete()
- `regenerateDocumentExplanations(documentId)` — batch generate with manager.updateExplanation() per slide
- `setCachedExplanation(slideId, explanation)` — single slide update via manager.updateExplanation()
- `deleteFolder`, `createFolder`, `moveDocument` — folder operations (unchanged from current)

Key change from current code: all cache writes go through `manager.set()` or `manager.updateExplanation()`. No direct memory/IDB writes.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx next build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/useDocumentActions.ts
git commit -m "feat(frontend): add useDocumentActions hook"
```

---

## Task 10: Frontend — Rewrite useUpload as thin coordinator

**Files:**
- Rewrite: `frontend/hooks/useUpload.ts`
- Delete: `frontend/lib/localCache.ts`

- [ ] **Step 1: Rewrite useUpload.ts**

The new useUpload should be ~80-100 lines. It:
- Creates `DocumentCacheManager` instance (keyed by userId)
- Composes `useDocumentCache`, `usePreload`, `useDocumentActions`
- Manages library/folder state (not moved to manager)
- Manages loading/status state
- Exposes the SAME return type as current useUpload (UploadState & UploadActions)

```typescript
// frontend/hooks/useUpload.ts (new, ~80 lines)
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DocumentCacheManager } from "@/lib/DocumentCacheManager";
import { useDocumentCache } from "@/hooks/useDocumentCache";
import { usePreload } from "@/hooks/usePreload";
// import { useDocumentActions } from "@/hooks/useDocumentActions";
import { fetchBootstrap, fetchFolderLibrary, type DocumentLibrary, type DocumentListItem } from "@/lib/api";
import { getUser } from "@/lib/auth";

// ... coordinator that wires everything together
// Key: same return type as before, page.tsx changes minimal
```

- [ ] **Step 2: Delete localCache.ts**

```bash
rm frontend/lib/localCache.ts
```

- [ ] **Step 3: Update page.tsx**

Minimal changes to `page.tsx`:
- Replace `upload.cachedExplanations[currentSlide.id]` with the new explanation lookup from `useDocumentCache`
- The `useEffect` at line 166-175 should read from the new hook's `explanationsBySlideId`

- [ ] **Step 4: Verify full build**

Run: `cd frontend && npx next build`
Expected: Build succeeds, no type errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(frontend): rewrite useUpload as thin coordinator, delete localCache.ts"
```

---

## Task 11: Integration testing

Testing uses the tools already in the repo: **backend pytest** for API/model tests, **Playwright** for browser-level cache/sync tests. No new test runner needed.

**Files:**
- Modify: `backend/tests/test_sync.py` (already created in Tasks 1-3, add more cases)
- Rewrite: `tests/test_local_cache.py` → `tests/test_cache_sync.py` (Playwright-based)

- [ ] **Step 1: Backend tests (pytest) — add version bump + manifest cases**

Add to `backend/tests/test_sync.py`:

```python
def test_content_version_bumps_on_explanation_generate(client, auth_headers, sample_document_id):
    """Generate explanation → document.content_version should increase."""
    # Get initial version
    resp = client.get("/api/v1/sync/manifest", headers=auth_headers)
    v_before = resp.json()["documents"][sample_document_id]["version"]
    # Generate explanation for first slide
    # ... (trigger generation)
    # Check version bumped
    resp = client.get("/api/v1/sync/manifest", headers=auth_headers)
    v_after = resp.json()["documents"][sample_document_id]["version"]
    assert v_after > v_before

def test_manifest_excludes_deleted_documents(client, auth_headers, sample_document_id):
    """After deleting a document, manifest should not include it."""
    client.delete(f"/api/v1/documents/{sample_document_id}", headers=auth_headers)
    resp = client.get("/api/v1/sync/manifest", headers=auth_headers)
    assert sample_document_id not in resp.json()["documents"]

def test_manifest_includes_schema_versions(client, auth_headers):
    """Manifest schema block should match current global constants."""
    resp = client.get("/api/v1/sync/manifest", headers=auth_headers)
    schema = resp.json()["schema"]
    from app.services.explanation_engine import CURRENT_EXPLANATION_VERSION
    from app.services.slide_processor import CURRENT_EXTRACT_SCHEMA_VERSION
    assert schema["explanation_version"] == CURRENT_EXPLANATION_VERSION
    assert schema["extract_version"] == CURRENT_EXTRACT_SCHEMA_VERSION

def test_cache_batch_includes_content_version(client, auth_headers, sample_document_id):
    """Cache-batch response should include content_version for each document."""
    resp = client.get(f"/api/v1/documents/cache-batch?document_id={sample_document_id}", headers=auth_headers)
    assert resp.status_code == 200
    doc = resp.json()["documents"][0]
    assert "content_version" in doc
    assert isinstance(doc["content_version"], int)
```

- [ ] **Step 2: Run backend tests**

Run: `cd backend && python -m pytest tests/test_sync.py -v`
Expected: ALL PASS

- [ ] **Step 3: Playwright tests — cache sync lifecycle**

Rewrite `tests/test_cache_sync.py` (Playwright-based, same pattern as existing `tests/test_local_cache.py`):

Test cases (run in browser via Playwright `page.evaluate()`):

1. **DocumentCacheManager.set() persists to IDB**: Create manager, set() a doc, read from IDB, verify match
2. **DocumentCacheManager.delete() removes from IDB**: Set doc, delete(), verify gone from IDB
3. **diffManifest removes stale local docs**: Set 3 docs locally, call diffManifest with only 2 in manifest, verify third is removed
4. **diffManifest detects version change**: Set doc with version=1, manifest has version=2, verify it's in `updated` list
5. **Schema change marks all as updated**: Set schema locally, call diffManifest with different schema versions, verify ALL docs in `updated`
6. **updateExplanation preserves existing on error path**: Set doc with explanation, call updateExplanation with `explanation: null, slideState: "error"`, verify original explanation preserved
7. **Multi-user isolation**: Create manager for "user-A", set data, create manager for "user-B", verify user-B cannot see user-A data

Run: `python tests/test_cache_sync.py` (uses Playwright like the existing test)
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_sync.py tests/test_cache_sync.py
git commit -m "test: backend + browser integration tests for cache sync"
```

---

## Task 12: Cleanup and final verification

- [ ] **Step 1: Remove all old cache code**

Verify these are gone from the codebase:
- `slideCacheRef` / `explanationCacheRef` in useUpload.ts
- `cachedExplanations` React state in useUpload.ts
- Any `import` from `localCache.ts`
- Any `setLocalSlides` / `setLocalExplanations` / `getCachedSlides` calls

- [ ] **Step 2: Full build + manual smoke test**

Run: `cd frontend && npx next build`
Run: `cd backend && python -m pytest tests/ -v`

Manual test checklist:
- [ ] Login → loading screen → first doc visible
- [ ] Switch document → explanation shows
- [ ] Generate explanation → shows immediately
- [ ] Refresh page → cached data loads instantly
- [ ] Delete document → removed from sidebar and cache

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "refactor: complete data flow refactor — single source of truth via DocumentCacheManager"
```
