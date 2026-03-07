"use client";

import { useEffect, useState } from "react";

import {
  createSession,
  deleteDocument as deleteDocumentRequest,
  fetchDocumentExplanations,
  fetchDocuments,
  fetchDocumentStatus,
  fetchSlides,
  generateDocumentExplanations as generateDocumentExplanationsRequest,
  pollDocumentReady,
  uploadDocument,
  type DocumentListItem,
  type Slide,
} from "@/lib/api";

type UploadState = {
  documentId: string | null;
  sessionId: string | null;
  slides: Slide[];
  documents: DocumentListItem[];
  cachedExplanations: Record<string, string>;
  loading: boolean;
  statusText: string;
};

type UploadActions = {
  handleUpload: (file: File) => Promise<void>;
  loadDocument: (documentId: string) => Promise<void>;
  deleteDocument: (documentId: string) => Promise<void>;
  regenerateDocumentExplanations: (documentId: string) => Promise<void>;
  setCachedExplanation: (slideId: string, markdown: string) => void;
  refreshDocuments: () => Promise<void>;
  reset: () => void;
};

export function useUpload(): UploadState & UploadActions {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [cachedExplanations, setCachedExplanations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("请先上传 PDF/图片开始学习。");

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
    setCachedExplanations(Object.fromEntries(explanations.map((item) => [item.slide_id, item.markdown])));

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
    setLoading(true);
    setStatusText("正在覆盖生成整份讲解...");
    try {
      await generateDocumentExplanationsRequest(targetDocumentId);
      if (documentId === targetDocumentId) {
        await hydrateDocument(targetDocumentId, { resetSession: false });
      }
      await refreshDocuments();
      setStatusText("整份讲解已重新生成并覆盖缓存。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setStatusText(`整份生成失败：${message}`);
      throw error;
    } finally {
      setLoading(false);
    }
  }

  function setCachedExplanation(slideId: string, markdown: string) {
    setCachedExplanations((prev) => ({ ...prev, [slideId]: markdown }));
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
    handleUpload,
    loadDocument,
    deleteDocument,
    regenerateDocumentExplanations,
    setCachedExplanation,
    refreshDocuments,
    reset,
  };
}
