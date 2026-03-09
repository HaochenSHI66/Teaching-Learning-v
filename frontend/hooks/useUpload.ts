"use client";

import { useEffect, useRef, useState } from "react";

import {
  createSession,
  deleteDocument as deleteDocumentRequest,
  fetchDocumentExplanations,
  fetchDocuments,
  fetchDocumentStatus,
  fetchSlides,
  generateSlideExplanation,
  pollDocumentReady,
  uploadDocument,
  type DocumentListItem,
  type Slide,
  type SlideExplanation,
} from "@/lib/api";

type GenerationProgress = { current: number; total: number };

type UploadState = {
  documentId: string | null;
  sessionId: string | null;
  slides: Slide[];
  documents: DocumentListItem[];
  cachedExplanations: Record<string, SlideExplanation>;
  loading: boolean;
  statusText: string;
  generationDocId: string | null;
  generationProgress: GenerationProgress | null;
};

type UploadActions = {
  handleUpload: (file: File) => Promise<void>;
  loadDocument: (documentId: string) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  regenerateDocumentExplanations: (documentId: string) => Promise<void>;
  abortGeneration: () => void;
  setCachedExplanation: (slideId: string, explanation: SlideExplanation) => void;
  refreshDocuments: () => Promise<void>;
  reset: () => void;
};

export function useUpload(): UploadState & UploadActions {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [cachedExplanations, setCachedExplanations] = useState<Record<string, SlideExplanation>>({});
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("请先上传 PDF/图片开始学习。");
  const [generationDocId, setGenerationDocId] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    void refreshDocuments();
  }, []);

  async function refreshDocuments() {
    try {
      const list = await fetchDocuments();
      setDocuments(list);
    } catch {
      // ignore silent refresh errors
    }
  }

  async function hydrateDocument(targetDocumentId: string, options?: { resetSession?: boolean }) {
    const fetchedSlides = await fetchSlides(targetDocumentId);
    const explanations = await fetchDocumentExplanations(targetDocumentId);

    setDocumentId(targetDocumentId);
    setSlides(fetchedSlides);
    setCachedExplanations(Object.fromEntries(explanations.map((item) => [item.slide_id, item])));

    if (options?.resetSession ?? true) {
      const newSession =
        fetchedSlides.length > 0 ? await createSession(targetDocumentId, fetchedSlides[0].id) : null;
      setSessionId(newSession?.id ?? null);
    }

    setStatusText(`文档加载完成，共 ${fetchedSlides.length} 页。`);
  }

  async function loadDocument(targetDocumentId: string) {
    setLoading(true);
    setStatusText("正在加载文档...");
    try {
      const status = await fetchDocumentStatus(targetDocumentId);
      if (status.status === "processing") {
        setStatusText("文档仍在处理中，正在等待缓存讲解生成...");
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

      await hydrateDocument(targetDocumentId, { resetSession: true });
      await refreshDocuments();
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    setLoading(true);
    setStatusText("正在上传文件...");
    try {
      const upload = await uploadDocument(file);
      await refreshDocuments();
      await loadDocument(upload.document.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`上传失败：${message}`);
    } finally {
      setLoading(false);
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
          setDocuments([]);
          setStatusText("文档已删除，当前资料库为空。");
        }
      } else {
        const nextDocuments = currentDocuments.filter((item) => item.id !== targetDocumentId);
        setDocuments(nextDocuments);
        setStatusText("文档已删除。");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`删除失败：${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function regenerateDocumentExplanations(targetDocumentId: string) {
    abortRef.current = false;
    setLoading(true);
    setGenerationDocId(targetDocumentId);
    setStatusText("获取页面列表中…");
    try {
      const targetSlides = await fetchSlides(targetDocumentId);
      const total = targetSlides.length;
      setGenerationProgress({ current: 0, total });

      let completed = 0;
      for (const slide of targetSlides) {
        if (abortRef.current) {
          setStatusText(`已中止（${completed}/${total} 页）`);
          break;
        }
        setStatusText(`生成解析中… ${completed + 1}/${total} 页`);
        const result = await generateSlideExplanation(targetDocumentId, slide.id);
        completed++;
        setGenerationProgress({ current: completed, total });
        setCachedExplanations((prev) => ({ ...prev, [slide.id]: result }));
        setSlides((prev) =>
          prev.map((s) => (s.id === slide.id ? { ...s, explanation_state: "ready" as const } : s)),
        );
      }

      if (!abortRef.current) {
        setStatusText(`解析已生成（${completed}/${total} 页）`);
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
    setCachedExplanations({});
    setStatusText("请先上传 PDF/图片开始学习。");
  }

  return {
    documentId,
    sessionId,
    slides,
    documents,
    cachedExplanations,
    loading,
    statusText,
    generationDocId,
    generationProgress,
    handleUpload,
    loadDocument,
    deleteDocument,
    regenerateDocumentExplanations,
    abortGeneration,
    setCachedExplanation,
    refreshDocuments,
    reset,
  };
}
