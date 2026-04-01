"use client";

/**
 * Local IndexedDB cache for slides + explanations.
 * First login: download all → store locally.
 * Subsequent visits: read from local → instant load, refresh in background.
 */

const DB_NAME = "teaching-learning-cache";
const DB_VERSION = 1;
const STORE_SLIDES = "slides";       // key: documentId, value: Slide[]
const STORE_EXPLANATIONS = "explanations"; // key: documentId, value: SlideExplanation[]
const STORE_META = "meta";           // key: "lastSync", value: timestamp

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SLIDES)) db.createObjectStore(STORE_SLIDES);
      if (!db.objectStoreNames.contains(STORE_EXPLANATIONS)) db.createObjectStore(STORE_EXPLANATIONS);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getFromStore<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}

async function putToStore(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Public API ──

export async function getCachedSlides(documentId: string) {
  return getFromStore<any[]>(STORE_SLIDES, documentId);
}

export async function setCachedSlides(documentId: string, slides: any[]) {
  return putToStore(STORE_SLIDES, documentId, slides);
}

export async function getCachedExplanations(documentId: string) {
  return getFromStore<any[]>(STORE_EXPLANATIONS, documentId);
}

export async function setCachedExplanationsLocal(documentId: string, explanations: any[]) {
  return putToStore(STORE_EXPLANATIONS, documentId, explanations);
}

export async function getLastSyncTime(): Promise<number> {
  const ts = await getFromStore<number>(STORE_META, "lastSync");
  return ts ?? 0;
}

export async function setLastSyncTime() {
  return putToStore(STORE_META, "lastSync", Date.now());
}

/** Check if local cache is fresh (< maxAge ms, default 2 hours) */
export async function isCacheFresh(maxAgeMs = 2 * 60 * 60 * 1000): Promise<boolean> {
  const last = await getLastSyncTime();
  return Date.now() - last < maxAgeMs;
}

/** Clear all cached data */
export async function clearLocalCache(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_SLIDES, STORE_EXPLANATIONS, STORE_META], "readwrite");
  tx.objectStore(STORE_SLIDES).clear();
  tx.objectStore(STORE_EXPLANATIONS).clear();
  tx.objectStore(STORE_META).clear();
  return new Promise((resolve) => { tx.oncomplete = () => resolve(); });
}
