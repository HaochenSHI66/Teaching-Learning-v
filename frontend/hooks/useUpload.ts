"use client";

import { useEffect, useRef, useState } from "react";

import {
  getCachedSlides,
  setCachedSlides as setLocalSlides,
  getCachedExplanations as getLocalExplanations,
  setCachedExplanationsLocal as setLocalExplanations,
  isCacheFresh,
  setLastSyncTime,
} from "@/lib/localCache";
import {
  createSession,
  createFolder as createFolderRequest,
  deleteDocument as deleteDocumentRequest,
  deleteFolder as deleteFolderRequest,
  fetchBootstrap,
  fetchDocumentCacheBatch,
  fetchDocumentExplanations,
  fetchDocumentStatus,
  fetchExplanationsWithPrefetch,
  fetchFolderLibrary,
  fetchSlides,
  fetchSlidesWithPrefetch,
  generateSlideExplanation,
  getAssetUrl,
  moveDocumentToFolder,
  pollDocumentReady,
  uploadDocument,
  type DocumentLibrary,
  type DocumentListItem,
  type FolderDocumentItem,
  type Slide,
  type SlideExplanation,
} from "@/lib/api";

type GenerationProgress = { current: number; total: number };

type UploadState = {
  documentId: string | null;
  sessionId: string | null;
  slides: Slide[];
  documents: DocumentListItem[];
  library: DocumentLibrary;
  cachedExplanations: Record<string, SlideExplanation>;
  loading: boolean;
  /** True while a newly-uploaded document is being processed in the background.
   *  Does NOT block foreground interactions (switching documents, etc.). */
  backgroundProcessing: boolean;
  /** True once the initial document library fetch has completed (success or failure). */
  initialLoaded: boolean;
  statusText: string;
  generationDocId: string | null;
  generationProgress: GenerationProgress | null;
};

type UploadActions = {
  handleUpload: (file: File, folderId?: string | null) => Promise<void>;
  loadDocument: (documentId: string) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  deleteFolder: (folderId: string) => Promise<void>;
  createFolder: (name: string, color?: string) => Promise<void>;
  moveDocument: (documentId: string, targetFolderId: string | null, targetIndex: number) => Promise<void>;
  regenerateDocumentExplanations: (documentId: string) => Promise<void>;
  abortGeneration: () => void;
  setCachedExplanation: (slideId: string, explanation: SlideExplanation) => void;
  refreshDocuments: () => Promise<void>;
  reset: () => void;
};


const EMPTY_LIBRARY: DocumentLibrary = {
  folders: [],
  uncategorized: { id: "uncategorized", name: "未归类", documents: [] },
};

const PRELOAD_START_DELAY_MS = 4_000;
const PRELOAD_BATCH_SIZE = 4;
const PRELOAD_BATCH_CONCURRENCY = 2;

function flattenLibrary(library: DocumentLibrary): DocumentListItem[] {
  return [
    ...library.folders.flatMap((folder) => folder.documents),
    ...library.uncategorized.documents,
  ];
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function countReadySlides(items: Slide[]): number {
  return items.reduce((total, slide) => total + (slide.explanation_state === "ready" ? 1 : 0), 0);
}

function hasCompleteExplanationCache(slides: Slide[] | undefined, explanations: SlideExplanation[] | undefined): boolean {
  if (!slides || !explanations) return false;
  const requiredReadyCount = countReadySlides(slides);
  if (requiredReadyCount === 0) return true;
  return new Set(explanations.map((item) => item.slide_id)).size >= requiredReadyCount;
}

function moveLibraryDocument(
  library: DocumentLibrary,
  documentId: string,
  targetFolderId: string | null,
  targetIndex: number,
): DocumentLibrary {
  const next: DocumentLibrary = {
    folders: library.folders.map((folder) => ({
      ...folder,
      documents: folder.documents.map((doc) => ({ ...doc })),
    })),
    uncategorized: {
      ...library.uncategorized,
      documents: library.uncategorized.documents.map((doc) => ({ ...doc })),
    },
  };

  const groups = [
    ...next.folders.map((folder) => ({ folderId: folder.id as string | null, documents: folder.documents })),
    { folderId: null as string | null, documents: next.uncategorized.documents },
  ];

  let moving: FolderDocumentItem | null = null;
  for (const group of groups) {
    const index = group.documents.findIndex((doc) => doc.id === documentId);
    if (index >= 0) {
      moving = group.documents.splice(index, 1)[0];
      break;
    }
  }
  if (!moving) return library;

  const targetGroup =
    groups.find((group) => group.folderId === targetFolderId) ??
    groups.find((group) => group.folderId === null);
  if (!targetGroup) return library;

  const insertIndex = Math.min(targetIndex, targetGroup.documents.length);
  targetGroup.documents.splice(insertIndex, 0, { ...moving, folder_id: targetFolderId });

  for (const group of groups) {
    group.documents.forEach((doc, index) => {
      doc.folder_id = group.folderId;
      doc.sort_order = index;
    });
  }

  return next;
}

export function useUpload(): UploadState & UploadActions {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [library, setLibrary] = useState<DocumentLibrary>(EMPTY_LIBRARY);
  const [cachedExplanations, setCachedExplanations] = useState<Record<string, SlideExplanation>>({});
  const [loading, setLoading] = useState(false);
  const [backgroundProcessing, setBackgroundProcessing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [statusText, setStatusText] = useState("请先上传 PDF/图片开始学习。");
  const [generationDocId, setGenerationDocId] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const abortRef = useRef(false);
  /** Abort controller for background upload polling. */
  const pollAbortRef = useRef<AbortController | null>(null);
  /** Tracks the document ID that hydrateDocument's auto-generation is working on. */
  const autoGenDocRef = useRef<string | null>(null);
  /** Ref that always holds the current documentId for stale-closure checks. */
  const documentIdRef = useRef<string | null>(null);
  /** Track document IDs that have already been auto-generated to avoid repeating. */
  const autoGenDoneRef = useRef<Set<string>>(new Set());
  /** Monotonic run ID for background full-library preload. */
  const preloadRunRef = useRef(0);

  useEffect(() => {
    void bootstrapLoad();
  }, []);

  // Keep documentIdRef in sync for stale-closure checks in fire-and-forget async blocks.
  useEffect(() => {
    documentIdRef.current = documentId;
  }, [documentId]);

  function hasFullCachedDocument(targetDocumentId: string): boolean {
    // Simply check if we have slides data cached — don't check explanation completeness
    // (which incorrectly skips docs with no generated explanations)
    return slideCacheRef.current.has(targetDocumentId);
  }

  function prioritizeDocumentsForPreload(
    docs: DocumentListItem[],
    priorityDocumentId?: string | null,
  ): DocumentListItem[] {
    if (!priorityDocumentId) return docs;
    const priorityDoc = docs.find((doc) => doc.id === priorityDocumentId);
    if (!priorityDoc) return docs;
    return [priorityDoc, ...docs.filter((doc) => doc.id !== priorityDocumentId)];
  }

  async function restoreLocalCacheToMemory(docs: DocumentListItem[], currentDocumentId?: string | null) {
    await Promise.all(
      docs.map(async (doc) => {
        const [localSlides, localExp] = await Promise.all([
          getCachedSlides(doc.id).catch(() => undefined),
          getLocalExplanations(doc.id).catch(() => undefined),
        ]);
        if (localSlides) slideCacheRef.current.set(doc.id, localSlides);
        if (localExp) explanationCacheRef.current.set(doc.id, localExp);
      }),
    );

    const focusDocumentId = currentDocumentId ?? documentIdRef.current;
    if (!focusDocumentId) return;
    const localExp = explanationCacheRef.current.get(focusDocumentId);
    if (localExp) {
      setCachedExplanations(Object.fromEntries(localExp.map((item) => [item.slide_id, item])));
    }
  }

  /** One-shot bootstrap: try local cache first, fallback to network. */
  async function bootstrapLoad() {
    try {
      const data = await fetchBootstrap();
      setLibrary(data.folders);
      setDocuments(flattenLibrary(data.folders));

      const allDocs = flattenLibrary(data.folders).filter((d) => d.status === "ready");
      const initialDocumentId = data.first_document?.document_id ?? null;

      // Restore memory cache from IndexedDB in background (don't block loading screen)
      void (async () => {
        try {
          await restoreLocalCacheToMemory(allDocs, initialDocumentId);
        } catch {
          // IndexedDB restore failed — ignore
        }
        // Always preload to fill any gaps (preloadAllDocuments skips already-cached docs)
        try {
          await new Promise((resolve) => setTimeout(resolve, PRELOAD_START_DELAY_MS ?? 0));
        } catch { /* ignore */ }
        void preloadAllDocuments(allDocs, {
          priorityDocumentId: initialDocumentId,
          forceRefreshAll: false,
        });
      })();

      // If bootstrap includes first document data, show slides immediately
      if (data.first_document) {
        const { document_id, slides: fetchedSlides } = data.first_document;
        documentIdRef.current = document_id;
        setDocumentId(document_id);
        setSlides(fetchedSlides);
        slideCacheRef.current.set(document_id, fetchedSlides);
        setStatusText(`文档加载完成，共 ${fetchedSlides.length} 页。`);

        // If explanations already in local cache, use immediately; otherwise fetch
        const localExp = explanationCacheRef.current.get(document_id);
        if (localExp) {
          setCachedExplanations(Object.fromEntries(localExp.map((item) => [item.slide_id, item])));
        } else {
          fetchDocumentExplanations(document_id)
            .then((explanations) => {
              explanationCacheRef.current.set(document_id, explanations);
              void setLocalExplanations(document_id, explanations);
              if (documentIdRef.current === document_id) {
                setCachedExplanations(Object.fromEntries(explanations.map((item) => [item.slide_id, item])));
              }
            })
            .catch(() => {});
        }

        // Preload first slide image
        if (fetchedSlides.length > 0 && typeof window !== "undefined") {
          const img = new window.Image();
          img.src = getAssetUrl(fetchedSlides[0].image_url);
          for (const slide of fetchedSlides) {
            const t = new window.Image();
            t.src = getAssetUrl(slide.thumbnail_url);
          }
        }

        // Session + explanations: load async (don't block loading screen)
        if (fetchedSlides.length > 0) {
          createSession(document_id, fetchedSlides[0].id)
            .then((s) => setSessionId(s?.id ?? null))
            .catch(() => {});
        }
      }
      // preloadAllDocuments is now called from the IndexedDB check above

    } catch (err) {
      console.error("[useUpload] bootstrap failed, falling back to refreshDocuments:", err);
      // Fallback to old method
      try {
        const nextLibrary = await fetchFolderLibrary();
        setLibrary(nextLibrary);
        setDocuments(flattenLibrary(nextLibrary));
      } catch (err2) {
        console.error("[useUpload] refreshDocuments also failed:", err2);
      }
    } finally {
      setInitialLoaded(true);
    }
  }

  async function refreshDocuments() {
    try {
      const nextLibrary = await fetchFolderLibrary();
      setLibrary(nextLibrary);
      setDocuments(flattenLibrary(nextLibrary));
    } catch (err) {
      console.error("[useUpload] refreshDocuments failed:", err);
    }
  }

  async function hydrateDocument(targetDocumentId: string, options?: { resetSession?: boolean }) {
    // Use prefetch cache if available (hover-triggered), otherwise fetch fresh
    const slidesPromise = fetchSlidesWithPrefetch(targetDocumentId);
    const explanationsPromise = fetchExplanationsWithPrefetch(targetDocumentId);

    // Show slides as soon as they arrive — don't wait for explanations
    const fetchedSlides = await slidesPromise;
    setDocumentId(targetDocumentId);
    setSlides(fetchedSlides);
    slideCacheRef.current.set(targetDocumentId, fetchedSlides);

    // ── Preload images ──
    // Only BLOCK on the first slide image (what the user sees immediately).
    // Thumbnails load in background — they're small and lazy-loaded anyway.
    if (fetchedSlides.length > 0 && typeof window !== "undefined") {
      const preloadImg = (url: string) =>
        new Promise<void>((resolve) => {
          const img = new window.Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = getAssetUrl(url);
        });

      // Critical: only first slide image — blocks loading screen
      await Promise.race([
        preloadImg(fetchedSlides[0].image_url),
        new Promise<void>((r) => setTimeout(r, 3000)), // 3s max
      ]);

      // Fire-and-forget: thumbnails + nearby slides (don't await)
      for (const slide of fetchedSlides) {
        const t = new window.Image();
        t.src = getAssetUrl(slide.thumbnail_url);
      }
      for (let i = 1; i < Math.min(4, fetchedSlides.length); i++) {
        const img = new window.Image();
        img.src = getAssetUrl(fetchedSlides[i].image_url);
      }
    }

    // Session + explanations: fire-and-forget, don't block loading screen
    if (options?.resetSession ?? true) {
      const sessionPromise = fetchedSlides.length > 0
        ? createSession(targetDocumentId, fetchedSlides[0].id)
        : Promise.resolve(null);
      sessionPromise.then((s) => setSessionId(s?.id ?? null)).catch(() => {});
    }

    // Explanations load in background — user can already see slides
    explanationsPromise
      .then((explanations) => {
        explanationCacheRef.current.set(targetDocumentId, explanations);
        void setLocalExplanations(targetDocumentId, explanations);
        // Guard: only update React state if user is still on this document
        if (documentIdRef.current !== targetDocumentId) return;
        setCachedExplanations(Object.fromEntries(explanations.map((item) => [item.slide_id, item])));

        // Auto-generate explanations for first few slides if missing
        if (!autoGenDoneRef.current.has(targetDocumentId)) {
          autoGenDoneRef.current.add(targetDocumentId);
          const explanationMap = new Set(explanations.map((e) => e.slide_id));
          const slidesToGenerate = fetchedSlides
            .slice(0, 3)
            .filter((s) => !explanationMap.has(s.id));

          if (slidesToGenerate.length > 0) {
            autoGenDocRef.current = targetDocumentId;
            void (async () => {
              for (const slide of slidesToGenerate) {
                if (autoGenDocRef.current !== targetDocumentId) return;
                if (documentIdRef.current !== targetDocumentId) return;
                try {
                  const result = await generateSlideExplanation(targetDocumentId, slide.id);
                  if (autoGenDocRef.current !== targetDocumentId) return;
                  if (documentIdRef.current !== targetDocumentId) return;
                  setCachedExplanations((prev) => ({ ...prev, [slide.id]: result }));
                  setSlides((prev) =>
                    prev.map((s) => (s.id === slide.id ? { ...s, explanation_state: "ready" as const } : s)),
                  );
                } catch (err) {
                  console.error(`[useUpload] auto-gen slide ${slide.id} failed:`, err);
                }
              }
            })();
          }
        }
      })
      .catch((err) => console.error("[useUpload] explanations fetch failed:", err));

    setStatusText(`文档加载完成，共 ${fetchedSlides.length} 页。`);
  }

  // ── Cache: preloaded data for all documents ──
  const slideCacheRef = useRef<Map<string, Slide[]>>(new Map());
  const explanationCacheRef = useRef<Map<string, SlideExplanation[]>>(new Map());

  async function loadDocument(targetDocumentId: string) {
    pollAbortRef.current?.abort();
    autoGenDocRef.current = null;

    // Fast path: if slides are already cached, show immediately
    const cachedSlides = slideCacheRef.current.get(targetDocumentId);
    if (cachedSlides) {
      setLoading(true);
      setStatusText("切换文档...");
      setDocumentId(targetDocumentId);
      setSlides(cachedSlides);

      // Session in background
      if (cachedSlides.length > 0) {
        createSession(targetDocumentId, cachedSlides[0].id)
          .then((s) => setSessionId(s?.id ?? null))
          .catch(() => {});
        if (typeof window !== "undefined") {
          const img = new window.Image();
          img.src = getAssetUrl(cachedSlides[0].image_url);
        }
      }

      // Explanations: show cache immediately, then refresh from API
      setCachedExplanations({});

      // Show cached explanations first (instant)
      const cachedExp = explanationCacheRef.current.get(targetDocumentId);
      if (cachedExp && cachedExp.length > 0) {
        setCachedExplanations(Object.fromEntries(cachedExp.map((item) => [item.slide_id, item])));
      }

      // Always fetch fresh from API (catches newly generated explanations)
      fetchDocumentExplanations(targetDocumentId)
        .then((explanations) => {
          if (documentIdRef.current !== targetDocumentId) return;
          explanationCacheRef.current.set(targetDocumentId, explanations);
          void setLocalExplanations(targetDocumentId, explanations);
          setCachedExplanations(Object.fromEntries(explanations.map((item) => [item.slide_id, item])));
        })
        .catch(() => {});
      setStatusText(`文档加载完成，共 ${cachedSlides.length} 页。`);
      setLoading(false);
      return;
    }

    // Slow path: fetch from server
    setStatusText("正在加载文档...");
    try {
      const status = await fetchDocumentStatus(targetDocumentId);
      if (status.status === "processing") {
        setStatusText("文档仍在处理中，请稍候…");
        const finalStatus = await pollDocumentReady(targetDocumentId, (progress) => {
          if (progress.status === "processing") {
            setStatusText(`处理中（已完成 ${progress.page_count} 页）...`);
          }
        });
        if (finalStatus.status === "error") {
          setStatusText("文档处理失败，请重试上传。");
          return;
        }
      }

      if (status.status === "error") {
        setStatusText("文档处理失败，请重试上传。");
        return;
      }

      setLoading(true);
      await hydrateDocument(targetDocumentId, { resetSession: true });
      void refreshDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }

  /** Preload slides + explanations for ALL documents → memory + IndexedDB. */
  async function preloadAllDocuments(
    docs: DocumentListItem[],
    options?: { priorityDocumentId?: string | null; forceRefreshAll?: boolean },
  ) {
    const runId = preloadRunRef.current + 1;
    preloadRunRef.current = runId;

    const readyDocs = prioritizeDocumentsForPreload(
      docs.filter((d) => d.status === "ready"),
      options?.priorityDocumentId ?? documentIdRef.current,
    );
    const pendingDocIds = readyDocs
      .filter((doc) => options?.forceRefreshAll || !hasFullCachedDocument(doc.id))
      .map((doc) => doc.id);

    if (pendingDocIds.length === 0) {
      await setLastSyncTime();
      return;
    }

    const batches = chunkArray(pendingDocIds, PRELOAD_BATCH_SIZE);
    const queue = [...batches];
    let hadFailure = false;

    async function runWorker() {
      while (queue.length > 0 && preloadRunRef.current === runId) {
        const batch = queue.shift();
        if (!batch) return;

        try {
          const payload = await fetchDocumentCacheBatch(batch);
          if (preloadRunRef.current !== runId) return;

          const returnedIds = new Set(payload.documents.map((item) => item.document_id));
          if (batch.some((documentId) => !returnedIds.has(documentId))) {
            hadFailure = true;
          }

          await Promise.all(
            payload.documents.map(async (item) => {
              slideCacheRef.current.set(item.document_id, item.slides);
              explanationCacheRef.current.set(item.document_id, item.explanations);
              await Promise.all([
                setLocalSlides(item.document_id, item.slides),
                setLocalExplanations(item.document_id, item.explanations),
              ]);

              if (documentIdRef.current === item.document_id) {
                setCachedExplanations(Object.fromEntries(item.explanations.map((exp) => [exp.slide_id, exp])));
              }
            }),
          );
        } catch (err) {
          hadFailure = true;
          console.error("[useUpload] cache batch preload failed:", err);
        }
      }
    }

    const workerCount = Math.max(1, Math.min(PRELOAD_BATCH_CONCURRENCY, queue.length));
    await Promise.all(Array.from({ length: workerCount }, runWorker));

    if (
      preloadRunRef.current === runId &&
      !hadFailure &&
      readyDocs.every((doc) => hasFullCachedDocument(doc.id))
    ) {
      await setLastSyncTime();
    }
  }

  async function handleUpload(file: File, folderId?: string | null) {
    setBackgroundProcessing(true);
    setStatusText("正在上传文件...");
    try {
      const uploaded = await uploadDocument(file, folderId);
      // Refresh immediately so the new doc appears in the library with "processing" status.
      await refreshDocuments();
      setStatusText("文件已上传，后台处理中，可继续使用其他文档…");

      // Cancel any previous background poll.
      pollAbortRef.current?.abort();
      const controller = new AbortController();
      pollAbortRef.current = controller;

      // Poll in the background — does NOT block foreground interactions.
      void (async () => {
        try {
          await pollDocumentReady(uploaded.document.id, (progress) => {
            if (controller.signal.aborted) return;
            if (progress.status === "processing") {
              setStatusText(`后台处理中（${progress.page_count} 页已完成）…`);
            }
          }, controller.signal);
          await refreshDocuments();
          setStatusText("新文档处理完成，可在文档库中点击查看。");
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setStatusText("新文档处理超时或失败，请重新上传。");
        } finally {
          setBackgroundProcessing(false);
          if (pollAbortRef.current === controller) pollAbortRef.current = null;
        }
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`上传失败：${message}`);
      setBackgroundProcessing(false);
    }
  }

  async function deleteDocument(targetDocumentId: string) {
    // Cancel any in-flight background poll before deleting.
    pollAbortRef.current?.abort();
    setLoading(true);
    setStatusText("正在删除文档...");

    try {
      const currentDocuments = documents;
      const currentIndex = currentDocuments.findIndex((item) => item.id === targetDocumentId);
      const fallbackDocument =
        currentDocuments[currentIndex + 1] ??
        currentDocuments[currentIndex - 1] ??
        currentDocuments.find((item) => item.id !== targetDocumentId) ??
        null;

      await deleteDocumentRequest(targetDocumentId);

      if (documentId === targetDocumentId) {
        if (fallbackDocument) {
          await loadDocument(fallbackDocument.id);
          setStatusText(`已删除文档，已切换到《${fallbackDocument.filename}》。`);
        } else {
          reset();
          setLibrary(EMPTY_LIBRARY);
          setDocuments([]);
          setStatusText("文档已删除，当前资料库为空。");
        }
      } else {
        const nextLibrary = await fetchFolderLibrary();
        setLibrary(nextLibrary);
        setDocuments(flattenLibrary(nextLibrary));
        setStatusText("文档已删除。");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`删除失败：${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteFolder(folderId: string) {
    setLoading(true);
    try {
      await deleteFolderRequest(folderId);
      await refreshDocuments();
      setStatusText("文件夹已删除。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`删除文件夹失败：${message}`);
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function createFolder(name: string, color: string = "oat") {
    setLoading(true);
    setStatusText("正在创建文件夹...");
    try {
      await createFolderRequest({ name, color });
      await refreshDocuments();
      setStatusText(`文件夹《${name}》已创建。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`创建文件夹失败：${message}`);
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function moveDocument(documentIdToMove: string, targetFolderId: string | null, targetIndex: number) {
    const previousLibrary = library;
    const optimistic = moveLibraryDocument(previousLibrary, documentIdToMove, targetFolderId, targetIndex);
    setLibrary(optimistic);
    setDocuments(flattenLibrary(optimistic));
    setStatusText("正在移动文档...");

    try {
      await moveDocumentToFolder({
        documentId: documentIdToMove,
        targetFolderId,
        targetIndex,
      });
      const latestLibrary = await fetchFolderLibrary();
      setLibrary(latestLibrary);
      setDocuments(flattenLibrary(latestLibrary));
      setStatusText("文档已移动。");
    } catch (error) {
      setLibrary(previousLibrary);
      setDocuments(flattenLibrary(previousLibrary));
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`移动失败：${message}`);
      throw error;
    }
  }

  async function regenerateDocumentExplanations(targetDocumentId: string) {
    const CONCURRENCY = 3;
    abortRef.current = false;
    setLoading(true);
    setGenerationDocId(targetDocumentId);
    setStatusText("获取页面列表中…");
    try {
      const targetSlides = await fetchSlides(targetDocumentId);
      const total = targetSlides.length;
      setGenerationProgress({ current: 0, total });

      const queue = [...targetSlides];
      const completedRef = { value: 0 };

      async function runWorker() {
        while (queue.length > 0 && !abortRef.current) {
          const slide = queue.shift();
          if (!slide) break;
          try {
            const result = await generateSlideExplanation(targetDocumentId, slide.id);
            const nextExplanationList = [
              ...(explanationCacheRef.current.get(targetDocumentId) ?? []).filter((item) => item.slide_id !== slide.id),
              result,
            ].sort((a, b) => a.page_num - b.page_num);
            explanationCacheRef.current.set(targetDocumentId, nextExplanationList);
            void setLocalExplanations(targetDocumentId, nextExplanationList);
            completedRef.value++;
            setGenerationProgress({ current: completedRef.value, total });
            setStatusText(`生成解析中… ${completedRef.value}/${total} 页`);
            if (documentIdRef.current === targetDocumentId) {
              setCachedExplanations((prev) => ({ ...prev, [slide.id]: result }));
              setSlides((prev) =>
                prev.map((s) => (s.id === slide.id ? { ...s, explanation_state: "ready" as const } : s)),
              );
            }
            const cachedSlidesForDoc = slideCacheRef.current.get(targetDocumentId);
            if (cachedSlidesForDoc) {
              const nextSlidesForDoc = cachedSlidesForDoc.map((s) =>
                s.id === slide.id ? { ...s, explanation_state: "ready" as const } : s,
              );
              slideCacheRef.current.set(targetDocumentId, nextSlidesForDoc);
              void setLocalSlides(targetDocumentId, nextSlidesForDoc);
            }
          } catch (err) {
            console.error(`[useUpload] regenerate slide ${slide.id} failed:`, err);
            completedRef.value++;
            setGenerationProgress({ current: completedRef.value, total });
            if (documentIdRef.current === targetDocumentId) {
              setSlides((prev) =>
                prev.map((s) => (s.id === slide.id ? { ...s, explanation_state: "error" as const } : s)),
              );
            }
            const cachedSlidesForDoc = slideCacheRef.current.get(targetDocumentId);
            if (cachedSlidesForDoc) {
              const nextSlidesForDoc = cachedSlidesForDoc.map((s) =>
                s.id === slide.id ? { ...s, explanation_state: "error" as const } : s,
              );
              slideCacheRef.current.set(targetDocumentId, nextSlidesForDoc);
              void setLocalSlides(targetDocumentId, nextSlidesForDoc);
            }
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, runWorker));

      if (abortRef.current) {
        setStatusText(`已中止（${completedRef.value}/${total} 页）`);
      } else {
        setStatusText(`解析已生成（${completedRef.value}/${total} 页）`);
      }
      await refreshDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`整份生成失败：${message}`);
    } finally {
      setLoading(false);
      setGenerationDocId(null);
      setGenerationProgress(null);
      abortRef.current = false;
    }
  }

  function abortGeneration() {
    abortRef.current = true;
  }

  function setCachedExplanation(slideId: string, explanation: SlideExplanation) {
    setCachedExplanations((prev) => {
      const next = { ...prev, [slideId]: explanation };
      // Sync to IndexedDB: update the full explanations array for this document
      if (documentId) {
        const allExp = Object.values(next);
        explanationCacheRef.current.set(documentId, allExp);
        void setLocalExplanations(documentId, allExp);
      }
      return next;
    });
    setSlides((prev) => {
      const next = prev.map((slide) =>
        slide.id === slideId ? { ...slide, explanation_state: "ready" as const } : slide,
      );
      // Sync slides state to IndexedDB too
      if (documentId) {
        slideCacheRef.current.set(documentId, next);
        void setLocalSlides(documentId, next);
      }
      return next;
    });
  }

  function reset() {
    setDocumentId(null);
    setSessionId(null);
    setSlides([]);
    setLibrary(EMPTY_LIBRARY);
    setCachedExplanations({});
    setStatusText("请先上传 PDF/图片开始学习。");
  }

  return {
    documentId,
    sessionId,
    slides,
    documents,
    library,
    cachedExplanations,
    loading,
    backgroundProcessing,
    initialLoaded,
    statusText,
    generationDocId,
    generationProgress,
    handleUpload,
    loadDocument,
    deleteDocument,
    deleteFolder,
    createFolder,
    moveDocument,
    regenerateDocumentExplanations,
    abortGeneration,
    setCachedExplanation,
    refreshDocuments,
    reset,
  };
}
