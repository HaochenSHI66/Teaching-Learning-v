"use client";

import { useEffect, useRef, useState } from "react";

import {
  createSession,
  createFolder as createFolderRequest,
  deleteDocument as deleteDocumentRequest,
  deleteFolder as deleteFolderRequest,
  fetchDocumentExplanations,
  fetchDocumentStatus,
  fetchFolderLibrary,
  fetchSlides,
  generateSlideExplanation,
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

export function useUpload(): UploadState & UploadActions {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [library, setLibrary] = useState<DocumentLibrary>(EMPTY_LIBRARY);
  const [cachedExplanations, setCachedExplanations] = useState<Record<string, SlideExplanation>>({});
  const [loading, setLoading] = useState(false);
  const [backgroundProcessing, setBackgroundProcessing] = useState(false);
  const [statusText, setStatusText] = useState("请先上传 PDF/图片开始学习。");
  const [generationDocId, setGenerationDocId] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const abortRef = useRef(false);
  /** Track document IDs that have already been auto-generated to avoid repeating. */
  const autoGenDoneRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    void refreshDocuments();
  }, []);

  async function refreshDocuments() {
    try {
      const nextLibrary = await fetchFolderLibrary();
      setLibrary(nextLibrary);
      setDocuments(flattenLibrary(nextLibrary));
    } catch {
      // ignore silent refresh errors
    }
  }

  async function hydrateDocument(targetDocumentId: string, options?: { resetSession?: boolean }) {
    const [fetchedSlides, explanations] = await Promise.all([
      fetchSlides(targetDocumentId),
      fetchDocumentExplanations(targetDocumentId),
    ]);

    setDocumentId(targetDocumentId);
    setSlides(fetchedSlides);
    setCachedExplanations(Object.fromEntries(explanations.map((item) => [item.slide_id, item])));

    if (options?.resetSession ?? true) {
      const newSession =
        fetchedSlides.length > 0 ? await createSession(targetDocumentId, fetchedSlides[0].id) : null;
      setSessionId(newSession?.id ?? null);
    }

    setStatusText(`文档加载完成，共 ${fetchedSlides.length} 页。`);

    // Task 5: Auto-generate explanations for first few slides if missing
    if (!autoGenDoneRef.current.has(targetDocumentId)) {
      autoGenDoneRef.current.add(targetDocumentId);
      const explanationMap = new Set(explanations.map((e) => e.slide_id));
      const slidesToGenerate = fetchedSlides
        .slice(0, 3)
        .filter((s) => !explanationMap.has(s.id));

      if (slidesToGenerate.length > 0) {
        // Fire sequentially in background — don't block UI
        void (async () => {
          for (const slide of slidesToGenerate) {
            try {
              const result = await generateSlideExplanation(targetDocumentId, slide.id);
              setCachedExplanations((prev) => ({ ...prev, [slide.id]: result }));
              setSlides((prev) =>
                prev.map((s) => (s.id === slide.id ? { ...s, explanation_state: "ready" as const } : s)),
              );
            } catch {
              // Silently skip individual failures
            }
          }
        })();
      }
    }
  }

  async function loadDocument(targetDocumentId: string) {
    setStatusText("正在加载文档...");
    try {
      const status = await fetchDocumentStatus(targetDocumentId);
      if (status.status === "processing") {
        // Don't lock the UI while waiting — background poll handles this
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
      await refreshDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`加载失败：${message}`);
    } finally {
      setLoading(false);
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

      // Poll in the background — does NOT block foreground interactions.
      void (async () => {
        try {
          await pollDocumentReady(uploaded.document.id, (progress) => {
            if (progress.status === "processing") {
              setStatusText(`后台处理中（${progress.page_count} 页已完成）…`);
            }
          });
          await refreshDocuments();
          setStatusText("新文档处理完成，可在文档库中点击查看。");
        } catch {
          setStatusText("新文档处理超时或失败，请重新上传。");
        } finally {
          setBackgroundProcessing(false);
        }
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`上传失败：${message}`);
      setBackgroundProcessing(false);
    }
  }

  async function deleteDocument(targetDocumentId: string) {
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
            completedRef.value++;
            setGenerationProgress({ current: completedRef.value, total });
            setStatusText(`生成解析中… ${completedRef.value}/${total} 页`);
            setCachedExplanations((prev) => ({ ...prev, [slide.id]: result }));
            setSlides((prev) =>
              prev.map((s) => (s.id === slide.id ? { ...s, explanation_state: "ready" as const } : s)),
            );
          } catch {
            // Single page failure won't abort the whole batch
            completedRef.value++;
            setGenerationProgress({ current: completedRef.value, total });
            setSlides((prev) =>
              prev.map((s) => (s.id === slide.id ? { ...s, explanation_state: "error" as const } : s)),
            );
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
    setCachedExplanations((prev) => ({ ...prev, [slideId]: explanation }));
    setSlides((prev) =>
      prev.map((slide) =>
        slide.id === slideId ? { ...slide, explanation_state: "ready" } : slide,
      ),
    );
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
