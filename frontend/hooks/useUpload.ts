"use client";

import { useEffect, useState } from "react";

import {
  createSession,
  fetchDocumentExplanations,
  fetchDocuments,
  fetchDocumentStatus,
  fetchSlides,
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

  async function hydrateDocument(targetDocumentId: string) {
    const fetchedSlides = await fetchSlides(targetDocumentId);
    const explanations = await fetchDocumentExplanations(targetDocumentId);

    setDocumentId(targetDocumentId);
    setSlides(fetchedSlides);
    setCachedExplanations(Object.fromEntries(explanations.map((item) => [item.slide_id, item.markdown])));

    const newSession =
      fetchedSlides.length > 0 ? await createSession(targetDocumentId, fetchedSlides[0].id) : null;
    setSessionId(newSession?.id ?? null);

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

      await hydrateDocument(targetDocumentId);
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
    refreshDocuments,
    reset,
  };
}
