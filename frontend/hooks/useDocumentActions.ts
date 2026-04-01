// frontend/hooks/useDocumentActions.ts
"use client";

import { useCallback, useRef } from "react";
import type { DocumentCacheManager } from "@/lib/DocumentCacheManager";
import {
  createSession,
  createFolder as createFolderRequest,
  deleteDocument as deleteDocumentRequest,
  deleteFolder as deleteFolderRequest,
  fetchDocumentExplanations,
  fetchDocumentStatus,
  fetchFolderLibrary,
  fetchSlides,
  fetchSlidesWithPrefetch,
  fetchExplanationsWithPrefetch,
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

type ActionCallbacks = {
  setDocumentId: (id: string | null) => void;
  setSessionId: (id: string | null) => void;
  setLoading: (v: boolean) => void;
  setBackgroundProcessing: (v: boolean) => void;
  setStatusText: (s: string) => void;
  setLibrary: (lib: DocumentLibrary) => void;
  setDocuments: (docs: DocumentListItem[]) => void;
  setGenerationDocId: (id: string | null) => void;
  setGenerationProgress: (p: { current: number; total: number } | null) => void;
  getDocumentId: () => string | null;
  getDocuments: () => DocumentListItem[];
  getLibrary: () => DocumentLibrary;
  reset: () => void;
};

function flattenLibrary(library: DocumentLibrary): DocumentListItem[] {
  return [
    ...library.folders.flatMap((folder) => folder.documents),
    ...library.uncategorized.documents,
  ];
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

export function useDocumentActions(
  manager: DocumentCacheManager | null,
  callbacks: ActionCallbacks,
) {
  const abortRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const autoGenDocRef = useRef<string | null>(null);
  const autoGenDoneRef = useRef<Set<string>>(new Set());

  const refreshDocuments = useCallback(async () => {
    try {
      const nextLibrary = await fetchFolderLibrary();
      callbacks.setLibrary(nextLibrary);
      callbacks.setDocuments(flattenLibrary(nextLibrary));
    } catch (err) {
      console.error("[useDocumentActions] refreshDocuments failed:", err);
    }
  }, [callbacks]);

  const loadDocument = useCallback(async (targetDocumentId: string) => {
    if (!manager) return;
    pollAbortRef.current?.abort();
    autoGenDocRef.current = null;

    // Fast path: if document is in cache, show immediately
    const cached = manager.get(targetDocumentId);
    if (cached) {
      callbacks.setLoading(true);
      callbacks.setStatusText("切换文档...");
      callbacks.setDocumentId(targetDocumentId);

      // Session in background
      if (cached.slides.length > 0) {
        createSession(targetDocumentId, cached.slides[0].id)
          .then((s) => callbacks.setSessionId(s?.id ?? null))
          .catch(() => {});
        if (typeof window !== "undefined") {
          const img = new window.Image();
          img.src = getAssetUrl(cached.slides[0].image_url);
        }
      }

      // Always fetch fresh explanations from API to catch newly generated ones
      fetchDocumentExplanations(targetDocumentId)
        .then(async (explanations) => {
          if (callbacks.getDocumentId() !== targetDocumentId) return;
          const currentVersion = manager.getVersion(targetDocumentId) ?? 0;
          await manager.set(targetDocumentId, {
            slides: cached.slides,
            explanations,
            version: currentVersion,
          });
        })
        .catch(() => {});

      callbacks.setStatusText(`文档加载完成，共 ${cached.slides.length} 页。`);
      callbacks.setLoading(false);
      return;
    }

    // Slow path: fetch from server
    callbacks.setStatusText("正在加载文档...");
    try {
      const status = await fetchDocumentStatus(targetDocumentId);
      if (status.status === "processing") {
        callbacks.setStatusText("文档仍在处理中，请稍候…");
        const finalStatus = await pollDocumentReady(targetDocumentId, (progress) => {
          if (progress.status === "processing") {
            callbacks.setStatusText(`处理中（已完成 ${progress.page_count} 页）...`);
          }
        });
        if (finalStatus.status === "error") {
          callbacks.setStatusText("文档处理失败，请重试上传。");
          return;
        }
      }

      if (status.status === "error") {
        callbacks.setStatusText("文档处理失败，请重试上传。");
        return;
      }

      callbacks.setLoading(true);
      await hydrateDocument(targetDocumentId);
      void refreshDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      callbacks.setStatusText(`加载失败：${message}`);
    } finally {
      callbacks.setLoading(false);
    }
  }, [manager, callbacks, refreshDocuments]);

  async function hydrateDocument(targetDocumentId: string) {
    if (!manager) return;

    const slidesPromise = fetchSlidesWithPrefetch(targetDocumentId);
    const explanationsPromise = fetchExplanationsWithPrefetch(targetDocumentId);

    const fetchedSlides = await slidesPromise;
    callbacks.setDocumentId(targetDocumentId);

    // Store in cache manager
    await manager.set(targetDocumentId, {
      slides: fetchedSlides,
      explanations: [],
      version: 0,
    });

    // Preload first slide image
    if (fetchedSlides.length > 0 && typeof window !== "undefined") {
      const preloadImg = (url: string) =>
        new Promise<void>((resolve) => {
          const img = new window.Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = getAssetUrl(url);
        });

      await Promise.race([
        preloadImg(fetchedSlides[0].image_url),
        new Promise<void>((r) => setTimeout(r, 3000)),
      ]);

      for (const slide of fetchedSlides) {
        const t = new window.Image();
        t.src = getAssetUrl(slide.thumbnail_url);
      }
      for (let i = 1; i < Math.min(4, fetchedSlides.length); i++) {
        const img = new window.Image();
        img.src = getAssetUrl(fetchedSlides[i].image_url);
      }
    }

    // Session
    if (fetchedSlides.length > 0) {
      createSession(targetDocumentId, fetchedSlides[0].id)
        .then((s) => callbacks.setSessionId(s?.id ?? null))
        .catch(() => {});
    }

    // Explanations in background
    explanationsPromise
      .then(async (explanations) => {
        if (callbacks.getDocumentId() !== targetDocumentId) return;
        const currentVersion = manager.getVersion(targetDocumentId) ?? 0;
        await manager.set(targetDocumentId, {
          slides: fetchedSlides,
          explanations,
          version: currentVersion,
        });

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
                if (callbacks.getDocumentId() !== targetDocumentId) return;
                try {
                  const result = await generateSlideExplanation(targetDocumentId, slide.id);
                  if (autoGenDocRef.current !== targetDocumentId) return;
                  if (callbacks.getDocumentId() !== targetDocumentId) return;
                  await manager.updateExplanation(targetDocumentId, {
                    slideId: slide.id,
                    explanation: result,
                    slideState: "ready",
                    contentVersion: result.content_version ?? manager.getVersion(targetDocumentId) ?? 0,
                  });
                } catch (err) {
                  console.error(`[useDocumentActions] auto-gen slide ${slide.id} failed:`, err);
                }
              }
            })();
          }
        }
      })
      .catch((err) => console.error("[useDocumentActions] explanations fetch failed:", err));

    callbacks.setStatusText(`文档加载完成，共 ${fetchedSlides.length} 页。`);
  }

  const handleUpload = useCallback(async (file: File, folderId?: string | null) => {
    callbacks.setBackgroundProcessing(true);
    callbacks.setStatusText("正在上传文件...");
    try {
      const uploaded = await uploadDocument(file, folderId);
      await refreshDocuments();
      callbacks.setStatusText("文件已上传，后台处理中，可继续使用其他文档…");

      pollAbortRef.current?.abort();
      const controller = new AbortController();
      pollAbortRef.current = controller;

      void (async () => {
        try {
          await pollDocumentReady(uploaded.document.id, (progress) => {
            if (controller.signal.aborted) return;
            if (progress.status === "processing") {
              callbacks.setStatusText(`后台处理中（${progress.page_count} 页已完成）…`);
            }
          }, controller.signal);
          await refreshDocuments();
          callbacks.setStatusText("新文档处理完成，可在文档库中点击查看。");
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          callbacks.setStatusText("新文档处理超时或失败，请重新上传。");
        } finally {
          callbacks.setBackgroundProcessing(false);
          if (pollAbortRef.current === controller) pollAbortRef.current = null;
        }
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      callbacks.setStatusText(`上传失败：${message}`);
      callbacks.setBackgroundProcessing(false);
    }
  }, [callbacks, refreshDocuments]);

  const deleteDocument = useCallback(async (targetDocumentId: string) => {
    if (!manager) return;
    pollAbortRef.current?.abort();
    callbacks.setLoading(true);
    callbacks.setStatusText("正在删除文档...");

    try {
      const currentDocuments = callbacks.getDocuments();
      const currentIndex = currentDocuments.findIndex((item) => item.id === targetDocumentId);
      const fallbackDocument =
        currentDocuments[currentIndex + 1] ??
        currentDocuments[currentIndex - 1] ??
        currentDocuments.find((item) => item.id !== targetDocumentId) ??
        null;

      await deleteDocumentRequest(targetDocumentId);
      await manager.delete(targetDocumentId);

      if (callbacks.getDocumentId() === targetDocumentId) {
        if (fallbackDocument) {
          await loadDocument(fallbackDocument.id);
          callbacks.setStatusText(`已删除文档，已切换到《${fallbackDocument.filename}》。`);
        } else {
          callbacks.reset();
          callbacks.setStatusText("文档已删除，当前资料库为空。");
        }
      } else {
        const nextLibrary = await fetchFolderLibrary();
        callbacks.setLibrary(nextLibrary);
        callbacks.setDocuments(flattenLibrary(nextLibrary));
        callbacks.setStatusText("文档已删除。");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      callbacks.setStatusText(`删除失败：${message}`);
    } finally {
      callbacks.setLoading(false);
    }
  }, [manager, callbacks, loadDocument]);

  const deleteFolder = useCallback(async (folderId: string) => {
    callbacks.setLoading(true);
    try {
      await deleteFolderRequest(folderId);
      await refreshDocuments();
      callbacks.setStatusText("文件夹已删除。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      callbacks.setStatusText(`删除文件夹失败：${message}`);
      throw error;
    } finally {
      callbacks.setLoading(false);
    }
  }, [callbacks, refreshDocuments]);

  const createFolder = useCallback(async (name: string, color: string = "oat") => {
    callbacks.setLoading(true);
    callbacks.setStatusText("正在创建文件夹...");
    try {
      await createFolderRequest({ name, color });
      await refreshDocuments();
      callbacks.setStatusText(`文件夹《${name}》已创建。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      callbacks.setStatusText(`创建文件夹失败：${message}`);
      throw error;
    } finally {
      callbacks.setLoading(false);
    }
  }, [callbacks, refreshDocuments]);

  const moveDocument = useCallback(async (
    documentIdToMove: string,
    targetFolderId: string | null,
    targetIndex: number,
  ) => {
    const previousLibrary = callbacks.getLibrary();
    const optimistic = moveLibraryDocument(previousLibrary, documentIdToMove, targetFolderId, targetIndex);
    callbacks.setLibrary(optimistic);
    callbacks.setDocuments(flattenLibrary(optimistic));
    callbacks.setStatusText("正在移动文档...");

    try {
      await moveDocumentToFolder({
        documentId: documentIdToMove,
        targetFolderId,
        targetIndex,
      });
      const latestLibrary = await fetchFolderLibrary();
      callbacks.setLibrary(latestLibrary);
      callbacks.setDocuments(flattenLibrary(latestLibrary));
      callbacks.setStatusText("文档已移动。");
    } catch (error) {
      callbacks.setLibrary(previousLibrary);
      callbacks.setDocuments(flattenLibrary(previousLibrary));
      const message = error instanceof Error ? error.message : "未知错误";
      callbacks.setStatusText(`移动失败：${message}`);
      throw error;
    }
  }, [callbacks]);

  const regenerateDocumentExplanations = useCallback(async (targetDocumentId: string) => {
    if (!manager) return;
    const CONCURRENCY = 3;
    abortRef.current = false;
    callbacks.setLoading(true);
    callbacks.setGenerationDocId(targetDocumentId);
    callbacks.setStatusText("获取页面列表中…");
    try {
      const targetSlides = await fetchSlides(targetDocumentId);
      const total = targetSlides.length;
      callbacks.setGenerationProgress({ current: 0, total });

      const queue = [...targetSlides];
      const completedRef = { value: 0 };

      async function runWorker() {
        while (queue.length > 0 && !abortRef.current) {
          const slide = queue.shift();
          if (!slide) break;
          try {
            const result = await generateSlideExplanation(targetDocumentId, slide.id);
            await manager!.updateExplanation(targetDocumentId, {
              slideId: slide.id,
              explanation: result,
              slideState: "ready",
              contentVersion: result.content_version ?? manager!.getVersion(targetDocumentId) ?? 0,
            });
            completedRef.value++;
            callbacks.setGenerationProgress({ current: completedRef.value, total });
            callbacks.setStatusText(`生成解析中… ${completedRef.value}/${total} 页`);
          } catch (err) {
            console.error(`[useDocumentActions] regenerate slide ${slide.id} failed:`, err);
            await manager!.updateExplanation(targetDocumentId, {
              slideId: slide.id,
              explanation: null,
              slideState: "error",
              contentVersion: manager!.getVersion(targetDocumentId) ?? 0,
            });
            completedRef.value++;
            callbacks.setGenerationProgress({ current: completedRef.value, total });
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, runWorker));

      if (abortRef.current) {
        callbacks.setStatusText(`已中止（${completedRef.value}/${total} 页）`);
      } else {
        callbacks.setStatusText(`解析已生成（${completedRef.value}/${total} 页）`);
      }
      await refreshDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      callbacks.setStatusText(`整份生成失败：${message}`);
    } finally {
      callbacks.setLoading(false);
      callbacks.setGenerationDocId(null);
      callbacks.setGenerationProgress(null);
      abortRef.current = false;
    }
  }, [manager, callbacks, refreshDocuments]);

  const abortGeneration = useCallback(() => {
    abortRef.current = true;
  }, []);

  const setCachedExplanation = useCallback((slideId: string, explanation: SlideExplanation) => {
    if (!manager) return;
    const docId = callbacks.getDocumentId();
    if (!docId) return;
    void manager.updateExplanation(docId, {
      slideId,
      explanation,
      slideState: "ready",
      contentVersion: manager.getVersion(docId) ?? 0,
    });
  }, [manager, callbacks]);

  return {
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
  };
}
