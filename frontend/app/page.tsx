"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AIPanel } from "@/components/ai-panel";
import { DocumentLibrary } from "@/components/document-library";
import { ErrorBoundary } from "@/components/error-boundary";
import { ExportNotesModal } from "@/components/export-notes-modal";
import { FlashcardReview } from "@/components/flashcard-review";
import { SlideViewer } from "@/components/slide-viewer";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useChat } from "@/hooks/useChat";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useSlideGeneration } from "@/hooks/useSlideGeneration";
import { useUpload } from "@/hooks/useUpload";
import {
  askSlideQuestion,
  fetchBookmarks,
  fetchFlashcardStats,
  type Bookmark,
  type BookmarkTag,
  type FlashcardStats,
  type RoiBox,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errorMessage";

export default function Page() {
  const upload = useUpload();
  const chat = useChat();
  const { setExplanation, setExplanationMeta } = chat;

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [roi, setRoi] = useState<RoiBox | null>(null);
  const [globalStatus, setGlobalStatus] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [interactiveReady, setInteractiveReady] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkFilter, setBookmarkFilter] = useState<BookmarkTag | null>(null);
  const [flashcardReviewOpen, setFlashcardReviewOpen] = useState(false);
  const [flashcardStats, setFlashcardStats] = useState<FlashcardStats | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const currentSlide = useMemo(
    () => upload.slides[currentSlideIndex],
    [upload.slides, currentSlideIndex],
  );
  const currentDocumentName = useMemo(
    () => upload.documents.find((d) => d.id === upload.documentId)?.filename,
    [upload.documents, upload.documentId],
  );

  // Task 1 & 6: Keyboard navigation via extracted hook
  useKeyboardNavigation(upload.slides, currentSlideIndex, setCurrentSlideIndex);

  // Task 6: Slide generation via extracted hook
  const {
    slideGenerationLoading,
    setSlideGenerationLoading,
    handleGenerateCurrentSlideExplanation,
    handleBatchGenerate,
  } = useSlideGeneration({
    documentId: upload.documentId,
    slides: upload.slides,
    setCachedExplanation: upload.setCachedExplanation,
    setExplanation,
    setExplanationMeta,
    setGlobalStatus,
    currentSlide,
  });

  // Task 3: Show processing animation when backgroundProcessing and no slides loaded
  const showProcessingAnimation = upload.backgroundProcessing && upload.slides.length === 0;

  useEffect(() => {
    setCurrentSlideIndex(0);
    setRoi(null);
    setGlobalStatus("");
    setBookmarkFilter(null);
    chat.setChatInput("");
    chat.clearStatus();
    // Load bookmarks and flashcard stats for new document
    if (upload.documentId) {
      fetchBookmarks(upload.documentId).then(setBookmarks).catch(() => setBookmarks([]));
      fetchFlashcardStats(upload.documentId).then(setFlashcardStats).catch(() => setFlashcardStats(null));
    } else {
      setBookmarks([]);
      setFlashcardStats(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.documentId]);

  useEffect(() => {
    setRoi(null);
  }, [currentSlideIndex]);

  useEffect(() => {
    setInteractiveReady(true);
  }, []);

  useEffect(() => {
    if (!currentSlide) {
      setExplanation("");
      setExplanationMeta(null);
      return;
    }
    const cached = upload.cachedExplanations[currentSlide.id];
    setExplanation(cached?.markdown ?? "");
    setExplanationMeta(cached?.meta ?? null);
  }, [currentSlide, upload.cachedExplanations, setExplanation, setExplanationMeta]);

  const statusText =
    chat.statusText || upload.statusText || globalStatus || "待机";

  const loading =
    upload.loading || chat.loading || slideGenerationLoading;
  const documentCount = upload.documents.length;
  const pageCount = upload.slides.length;

  async function handleElaborateSelection(text: string) {
    if (!upload.sessionId || !currentSlide) {
      setGlobalStatus("请先选定页面");
      return;
    }
    setSlideGenerationLoading(true);
    setGlobalStatus("深入解析中…");
    try {
      const response = await askSlideQuestion({
        sessionId: upload.sessionId,
        message: `请对以下选中内容进行深入、详细的学术解析（约150～300字），结果补充至当前解析末尾：\n\n${text}`,
        slideId: currentSlide.id,
        mode: "slide",
      });
      const elaboration = `\n\n---\n\n**补充解析**\n\n${response.answer}`;
      setExplanation(chat.explanation ? `${chat.explanation}${elaboration}` : response.answer);
      setExplanationMeta(null);
      setGlobalStatus("已追加至解析");
    } catch (error) {
      setGlobalStatus(`深入解析失败：${getErrorMessage(error)}`);
    } finally {
      setSlideGenerationLoading(false);
    }
  }

  const refreshBookmarks = useCallback(() => {
    if (upload.documentId) {
      fetchBookmarks(upload.documentId).then(setBookmarks).catch(() => {});
    }
  }, [upload.documentId]);

  const handleJumpToSlide = useCallback(
    (slideId: string) => {
      const idx = upload.slides.findIndex((s) => s.id === slideId);
      if (idx >= 0) setCurrentSlideIndex(idx);
    },
    [upload.slides],
  );

  const handleDeleteDocument = useCallback(async (targetDocumentId: string, filename: string) => {
    const confirmed = window.confirm(`确认删除《${filename}》？该操作将清除缓存与会话记录。`);
    if (!confirmed) return;
    await upload.deleteDocument(targetDocumentId);
  }, [upload.deleteDocument]);

  const handleDeleteFolder = useCallback(async (folderId: string, name: string) => {
    const confirmed = window.confirm(`确认删除文件夹《${name}》？文件夹内的文档将移至未分类。`);
    if (!confirmed) return;
    await upload.deleteFolder(folderId);
  }, [upload.deleteFolder]);

  return (
    <ThemeProvider>
    <main className="relative flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="relative z-10 shrink-0 border-b border-[var(--bd-1)] bg-[var(--sf-header)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-2 md:px-5">
          <div className="flex items-center gap-2">
            {interactiveReady ? (
              <button
                className="flex h-8 w-8 flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--bd-1)] bg-[var(--sf-1)] hover:bg-[var(--sf-3)] transition-colors"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                type="button"
                aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              >
                <span className="h-[1.5px] w-4 rounded-full bg-[var(--tx-4)]" />
                <span className="h-[1.5px] w-4 rounded-full bg-[var(--tx-4)]" />
                <span className="h-[1.5px] w-4 rounded-full bg-[var(--tx-4)]" />
              </button>
            ) : (
              <div
                aria-hidden="true"
                className="h-8 w-8 rounded-xl border border-transparent"
              />
            )}
            <div>
              <p className="text-[9px] uppercase tracking-[0.28em] text-[var(--tx-5)]">Learning Studio</p>
              <h1 className="text-sm font-semibold leading-tight text-[var(--tx-2)]">幻灯片研习台</h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <button
              aria-label="闪卡复习"
              className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-medium transition-colors ${
                upload.documentId && upload.sessionId
                  ? "border-[var(--bd-1)] bg-[var(--sf-1)] text-[var(--tx-3)] hover:bg-[var(--sf-3)]"
                  : "cursor-not-allowed border-[var(--bd-2)] bg-[var(--sf-4)] text-[var(--tx-6)]"
              }`}
              disabled={!upload.documentId || !upload.sessionId}
              onClick={() => setFlashcardReviewOpen(true)}
              type="button"
            >
              <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M12 4v16" />
              </svg>
              <span>复习</span>
            </button>
            <button
              aria-label="导出学习笔记"
              className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-medium transition-colors ${
                upload.documentId
                  ? "border-[var(--bd-1)] bg-[var(--sf-1)] text-[var(--tx-3)] hover:bg-[var(--sf-3)]"
                  : "cursor-not-allowed border-[var(--bd-2)] bg-[var(--sf-4)] text-[var(--tx-6)]"
              }`}
              disabled={!upload.documentId}
              onClick={() => setExportModalOpen(true)}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>导出笔记</span>
            </button>
            <div className="rounded-full border border-[var(--bd-4)] bg-[var(--sf-3)] px-2.5 py-0.5 text-[11px] text-[var(--brand-sage)]">
              {documentCount} 篇
            </div>
            {/* Global parse progress capsule replaces page badge while generating */}
            {upload.generationProgress ? (
              <div className="flex items-center gap-1.5 rounded-full border border-[var(--bd-4)] bg-[var(--sf-1)] px-3 py-0.5 shadow-sm">
                <span className="text-[10px] animate-pulse">✦</span>
                <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-[var(--sf-4)]">
                  <div
                    className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-gradient-to-r from-[var(--brand-amber)] to-[var(--brand-sage)] transition-transform duration-500 ease-out"
                    style={{ transform: `scaleX(${upload.generationProgress.current / upload.generationProgress.total})` }}
                  />
                </div>
                <span className="tabular-nums text-[10px] text-[var(--tx-5)]">
                  {upload.generationProgress.current}/{upload.generationProgress.total}
                </span>
              </div>
            ) : (
              <div className="rounded-full border border-[var(--bd-4)] bg-[var(--sf-3)] px-2.5 py-0.5 text-[11px] text-[var(--tx-5)]">
                {currentSlide ? `P${currentSlide.page_num}/${pageCount || 0}` : "—"}
              </div>
            )}
            <div className="max-w-[300px] truncate rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] px-2.5 py-0.5 text-[11px] text-[var(--tx-4)]">
              {statusText}
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 overflow-hidden p-4 md:p-5">
        <aside
          className={`min-h-0 shrink-0 overflow-hidden rounded-[28px] border border-[var(--bd-1)] bg-[var(--sf-sidebar)] shadow-[var(--sh-panel)] backdrop-blur-xl transition-all duration-300 ${
            sidebarCollapsed ? "w-0 basis-0 min-w-0 p-0 border-0 opacity-0 pointer-events-none" : "w-[320px] basis-[320px]"
          }`}
        >
          <DocumentLibrary
            activeDocumentId={upload.documentId}
            backgroundProcessing={upload.backgroundProcessing}
            generationDocId={upload.generationDocId}
            generationProgress={upload.generationProgress}
            library={upload.library}
            loading={loading}
            onAbortGeneration={upload.abortGeneration}
            onCreateFolder={(name) => upload.createFolder(name)}
            onDeleteDocument={handleDeleteDocument}
            onDeleteFolder={handleDeleteFolder}
            onMoveDocument={upload.moveDocument}
            onRegenerateDocument={upload.regenerateDocumentExplanations}
            onSelectDocument={upload.loadDocument}
            onUpload={upload.handleUpload}
          />
        </aside>

        <section className="grid h-full min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1.18fr_0.92fr]">
            {/* Task 3: Processing animation for first upload */}
            {showProcessingAnimation ? (
              <div className="flex h-full flex-col items-center justify-center rounded-[30px] border border-[var(--bd-1)] bg-[var(--gd-processing)] shadow-[var(--sh-card)]">
                <svg className="mb-4 h-8 w-8 animate-spin text-[var(--tx-5)]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <p className="text-[15px] font-medium text-[var(--tx-2)]">正在处理您的文档...</p>
                <p className="mt-1 text-[13px] text-[var(--tx-5)]">完成后将自动显示</p>
              </div>
            ) : (
            <ErrorBoundary resetKey={upload.documentId}>
              <SlideViewer
                bookmarkFilter={bookmarkFilter}
                bookmarks={bookmarks}
                currentIndex={currentSlideIndex}
                documentId={upload.documentId ?? ""}
                flashcardStats={flashcardStats}
                onBookmarkFilterChange={setBookmarkFilter}
                onBookmarksChange={refreshBookmarks}
                onRoiChange={setRoi}
                onSelect={setCurrentSlideIndex}
                roi={roi}
                slides={upload.slides}
              />
            </ErrorBoundary>
            )}
            <ErrorBoundary resetKey={upload.documentId}>
              <AIPanel
                chatInput={chat.chatInput}
                chatMessages={chat.chatMessages}
                currentSlideId={currentSlide?.id}
                disabled={!currentSlide}
                documentId={upload.documentId ?? undefined}
                explanationState={currentSlide?.explanation_state ?? "not_generated"}
                explanationLoading={slideGenerationLoading}
                extraction={currentSlide?.extract ?? null}
                explanation={chat.explanation}
                explanationMeta={chat.explanationMeta}
                loading={loading}
                mode={chat.mode}
                onChatInputChange={chat.setChatInput}
                onClearSlideMessages={() => {
                  if (currentSlide) chat.clearSlideMessages(currentSlide.id);
                }}
                onElaborateSelection={handleElaborateSelection}
                onExplainRoi={() => {
                  if (currentSlide && roi && upload.sessionId) {
                    void chat.askRoi(roi, upload.sessionId, currentSlide);
                  }
                }}
                onGenerateExplanation={() => void handleGenerateCurrentSlideExplanation()}
                onBatchGenerate={() => void handleBatchGenerate()}
                onJumpToSlide={handleJumpToSlide}
                onModeChange={chat.setMode}
                onSendChat={() => {
                  const message = chat.chatInput;
                  chat.setChatInput("");
                  if (upload.sessionId) void chat.ask(message, upload.sessionId, currentSlide);
                }}
                roiReady={Boolean(roi)}
              />
            </ErrorBoundary>
        </section>
      </div>

      <FlashcardReview
        documentId={upload.documentId ?? ""}
        sessionId={upload.sessionId ?? ""}
        open={flashcardReviewOpen}
        onClose={() => setFlashcardReviewOpen(false)}
      />

      <ExportNotesModal
        documentId={upload.documentId ?? ""}
        documentName={currentDocumentName}
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
      />
    </main>
    </ThemeProvider>
  );
}
