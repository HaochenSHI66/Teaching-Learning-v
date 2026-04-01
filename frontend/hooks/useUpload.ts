"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocumentCacheManager } from "@/lib/DocumentCacheManager";
import { useDocumentCache } from "@/hooks/useDocumentCache";
import { usePreload } from "@/hooks/usePreload";
import { useDocumentActions } from "@/hooks/useDocumentActions";
import {
  createSession,
  fetchBootstrap,
  fetchFolderLibrary,
  getAssetUrl,
  type DocumentLibrary,
  type DocumentListItem,
  type Slide,
  type SlideExplanation,
} from "@/lib/api";
import { getUser } from "@/lib/auth";

type GenerationProgress = { current: number; total: number };

type UploadState = {
  documentId: string | null;
  sessionId: string | null;
  slides: Slide[];
  documents: DocumentListItem[];
  library: DocumentLibrary;
  cachedExplanations: Record<string, SlideExplanation>;
  loading: boolean;
  backgroundProcessing: boolean;
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

function flattenLibrary(library: DocumentLibrary): DocumentListItem[] {
  return [
    ...library.folders.flatMap((folder) => folder.documents),
    ...library.uncategorized.documents,
  ];
}

export function useUpload(): UploadState & UploadActions {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [library, setLibrary] = useState<DocumentLibrary>(EMPTY_LIBRARY);
  const [loading, setLoading] = useState(false);
  const [backgroundProcessing, setBackgroundProcessing] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [statusText, setStatusText] = useState("请先上传 PDF/图片开始学习。");
  const [generationDocId, setGenerationDocId] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);

  // Refs for stale-closure access
  const documentIdRef = useRef<string | null>(null);
  const documentsRef = useRef<DocumentListItem[]>([]);
  const libraryRef = useRef<DocumentLibrary>(EMPTY_LIBRARY);

  useEffect(() => { documentIdRef.current = documentId; }, [documentId]);
  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { libraryRef.current = library; }, [library]);

  // ── DocumentCacheManager (keyed by userId) ──
  const managerRef = useRef<DocumentCacheManager | null>(null);
  const [manager, setManager] = useState<DocumentCacheManager | null>(null);

  useEffect(() => {
    const user = getUser();
    if (user?.id && !managerRef.current) {
      const m = new DocumentCacheManager(user.id);
      managerRef.current = m;
      setManager(m);
    }
  }, []);

  // ── React bridge to cache manager ──
  const cache = useDocumentCache(manager, documentId);

  // ── Background sync via manifest ──
  usePreload(manager);

  // ── Callbacks object for useDocumentActions ──
  const actionCallbacks = useMemo(() => ({
    setDocumentId,
    setSessionId,
    setLoading,
    setBackgroundProcessing,
    setStatusText,
    setLibrary,
    setDocuments,
    setGenerationDocId,
    setGenerationProgress,
    getDocumentId: () => documentIdRef.current,
    getDocuments: () => documentsRef.current,
    getLibrary: () => libraryRef.current,
    reset: () => {
      setDocumentId(null);
      setSessionId(null);
      setLibrary(EMPTY_LIBRARY);
      setDocuments([]);
      setStatusText("请先上传 PDF/图片开始学习。");
    },
  }), []);

  const actions = useDocumentActions(manager, actionCallbacks);

  // ── Bootstrap ──
  useEffect(() => {
    void bootstrapLoad();
  }, []);

  async function bootstrapLoad() {
    try {
      const data = await fetchBootstrap();
      setLibrary(data.folders);
      setDocuments(flattenLibrary(data.folders));

      // Initialize manager if not done yet
      const user = getUser();
      let mgr = managerRef.current;
      if (!mgr && user?.id) {
        mgr = new DocumentCacheManager(user.id);
        managerRef.current = mgr;
        setManager(mgr);
      }

      if (data.first_document && mgr) {
        const { document_id, slides: fetchedSlides, content_version } = data.first_document;
        documentIdRef.current = document_id;
        setDocumentId(document_id);

        // Seed bootstrap data into cache manager
        await mgr.set(document_id, {
          slides: fetchedSlides,
          explanations: [],
          version: content_version ?? 0,
        });

        setStatusText(`文档加载完成，共 ${fetchedSlides.length} 页。`);

        // Preload first slide image
        if (fetchedSlides.length > 0 && typeof window !== "undefined") {
          const img = new window.Image();
          img.src = getAssetUrl(fetchedSlides[0].image_url);
          for (const slide of fetchedSlides) {
            const t = new window.Image();
            t.src = getAssetUrl(slide.thumbnail_url);
          }
        }

        // Session + explanations: load async
        if (fetchedSlides.length > 0) {
          createSession(document_id, fetchedSlides[0].id)
            .then((s) => setSessionId(s?.id ?? null))
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error("[useUpload] bootstrap failed:", err);
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

  function reset() {
    setDocumentId(null);
    setSessionId(null);
    setLibrary(EMPTY_LIBRARY);
    setDocuments([]);
    setStatusText("请先上传 PDF/图片开始学习。");
  }

  return {
    documentId,
    sessionId,
    slides: cache.slides,
    documents,
    library,
    cachedExplanations: cache.explanationsBySlideId,
    loading,
    backgroundProcessing,
    initialLoaded,
    statusText,
    generationDocId,
    generationProgress,
    handleUpload: actions.handleUpload,
    loadDocument: actions.loadDocument,
    deleteDocument: actions.deleteDocument,
    deleteFolder: actions.deleteFolder,
    createFolder: actions.createFolder,
    moveDocument: actions.moveDocument,
    regenerateDocumentExplanations: actions.regenerateDocumentExplanations,
    abortGeneration: actions.abortGeneration,
    setCachedExplanation: actions.setCachedExplanation,
    refreshDocuments: actions.refreshDocuments,
    reset,
  };
}
