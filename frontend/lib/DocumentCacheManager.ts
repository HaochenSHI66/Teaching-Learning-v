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

    // NOTE: Do NOT save schema version here. Caller (usePreload) must save
    // schema version only AFTER all updated docs are successfully fetched.
    // Otherwise a failed batch leaves local schema updated but docs stale.

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
