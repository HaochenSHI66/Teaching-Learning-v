"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AIPanel } from "@/components/ai-panel";
import { DocumentLibrary } from "@/components/document-library";
import { ErrorBoundary } from "@/components/error-boundary";
import { NotebookWindow } from "@/components/notebook-window";
import { SlideViewer } from "@/components/slide-viewer";
import { useChat } from "@/hooks/useChat";
import { useUpload } from "@/hooks/useUpload";
import {
  askSlideQuestion,
  autogenNotebook,
  exportNotebook,
  fetchNotebook,
  exportDocumentExplanations,
  generateSlideExplanation,
  saveNotebook,
  type RoiBox,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errorMessage";
import {
  formatNotebookMarkdown,
  inferPageTitle,
  insertSelectionIntoNotebook,
} from "@/lib/notebookFormat";

function downloadMarkdown(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const upload = useUpload();
  const chat = useChat();
  const { setExplanation, setExplanationMeta } = chat;

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [roi, setRoi] = useState<RoiBox | null>(null);
  const [notesMarkdown, setNotesMarkdown] = useState("");
  const [globalStatus, setGlobalStatus] = useState("");
  const [notebookBusy, setNotebookBusy] = useState(false);
  const [notebookSaving, setNotebookSaving] = useState(false);
  const [notebookSaveState, setNotebookSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [notebookViewMode, setNotebookViewMode] = useState<"edit" | "preview">("edit");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [slideGenerationLoading, setSlideGenerationLoading] = useState(false);
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  const [interactiveReady, setInteractiveReady] = useState(false);
  const notesMarkdownRef = useRef("");
  const notebookLastSavedRef = useRef("");
  const notebookDocumentRef = useRef<string | null>(null);

  const currentSlide = useMemo(
    () => upload.slides[currentSlideIndex],
    [upload.slides, currentSlideIndex],
  );
  const currentDocumentName = useMemo(
    () => upload.documents.find((d) => d.id === upload.documentId)?.filename,
    [upload.documents, upload.documentId],
  );

  useEffect(() => {
    setCurrentSlideIndex(0);
    setRoi(null);
    setGlobalStatus("");
    chat.setChatInput("");
    chat.clearStatus();
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

  const updateNotesMarkdown = useCallback((next: string) => {
    notesMarkdownRef.current = next;
    setNotesMarkdown(next);
  }, []);

  const statusText =
    chat.statusText || upload.statusText || globalStatus || "待机";

  const loading =
    upload.loading || chat.loading || notebookBusy || slideGenerationLoading;
  const documentCount = upload.documents.length;
  const pageCount = upload.slides.length;

  async function persistNotebook(targetDocumentId: string, markdown: string, silent: boolean = false) {
    if (!targetDocumentId) return;
    setNotebookSaving(true);
    setNotebookSaveState("saving");
    try {
      await saveNotebook(targetDocumentId, markdown);
      notebookLastSavedRef.current = markdown;
      setNotebookSaveState("saved");
      if (!silent) {
        setGlobalStatus("笔记本已保存");
      }
    } catch (error) {
      setNotebookSaveState("error");
      if (!silent) {
        setGlobalStatus(`笔记保存失败：${getErrorMessage(error)}`);
      }
    } finally {
      setNotebookSaving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadNotebookForDocument() {
      const previousDocumentId = notebookDocumentRef.current;
      const nextDocumentId = upload.documentId;
      if (
        previousDocumentId &&
        previousDocumentId !== nextDocumentId &&
        notebookLastSavedRef.current !== notesMarkdownRef.current
      ) {
        await persistNotebook(previousDocumentId, notesMarkdownRef.current, true);
      }

      notebookDocumentRef.current = nextDocumentId;
      if (!nextDocumentId) {
        setNotesMarkdown("");
        notesMarkdownRef.current = "";
        notebookLastSavedRef.current = "";
        setNotebookSaveState("idle");
        setNotePanelOpen(false);
        return;
      }

      setNotebookBusy(true);
      setNotebookSaveState("idle");
      try {
        const notebook = await fetchNotebook(nextDocumentId);
        if (cancelled) return;
        updateNotesMarkdown(notebook.markdown);
        notebookLastSavedRef.current = notebook.markdown;
      } catch (error) {
        if (cancelled) return;
        setGlobalStatus(`笔记本加载失败：${getErrorMessage(error)}`);
      } finally {
        if (!cancelled) {
          setNotebookBusy(false);
        }
      }
    }

    void loadNotebookForDocument();
    return () => {
      cancelled = true;
    };
  }, [upload.documentId]);

  useEffect(() => {
    if (!upload.documentId) return;
    if (notesMarkdown === notebookLastSavedRef.current) return;
    setNotebookSaveState("saving");
    const timer = window.setTimeout(() => {
      void persistNotebook(upload.documentId!, notesMarkdown, true);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [notesMarkdown, upload.documentId]);

  async function handleExportNotes() {
    if (!upload.documentId || !currentDocumentName) return;
    setNotebookBusy(true);
    setGlobalStatus("导出笔记本中…");
    try {
      const result = await exportNotebook(upload.documentId);
      downloadMarkdown(`${currentDocumentName.replace(/\.[^.]+$/, "")}-notebook.md`, result.markdown);
      setGlobalStatus("笔记本已导出");
    } catch (error) {
      setGlobalStatus(`导出失败：${getErrorMessage(error)}`);
    } finally {
      setNotebookBusy(false);
    }
  }

  async function handleExportAllExplanations() {
    if (!upload.documentId) return;
    setNotebookBusy(true);
    setGlobalStatus("导出解析中…");
    try {
      const result = await exportDocumentExplanations(upload.documentId);
      downloadMarkdown("all-slides-explanations.md", result.markdown);
      setGlobalStatus("解析已导出");
    } catch (error) {
      setGlobalStatus(`导出失败：${getErrorMessage(error)}`);
    } finally {
      setNotebookBusy(false);
    }
  }

  async function handleAutoGenerateNotes() {
    if (!upload.documentId) return;
    setNotebookBusy(true);
    setGlobalStatus("生成文档笔记本中…");
    try {
      const result = await autogenNotebook(upload.documentId, "自动笔记");
      updateNotesMarkdown(result.markdown);
      notebookLastSavedRef.current = result.markdown;
      setNotebookViewMode("preview");
      setNotePanelOpen(true);
      setNotebookSaveState("saved");
      setGlobalStatus("笔记本已生成");
    } catch (error) {
      setGlobalStatus(`笔记生成失败：${getErrorMessage(error)}`);
    } finally {
      setNotebookBusy(false);
    }
  }

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

  async function handleAIPolishNotes(content: string): Promise<string> {
    if (!upload.sessionId) return content;
    setGlobalStatus("润色中…");
    try {
      const response = await askSlideQuestion({
        sessionId: upload.sessionId,
        message:
          "请优化整理以下学习笔记，保留现有 Markdown 结构与所有核心信息，保留已有 <mark> 荧光标注，" +
          "并且只在真正值得记忆的定义、结论、公式、关键词上补充少量 <mark> 标注。" +
          "不要满屏高亮，不要改成讲义式长篇讲解，不要删除原有核心内容，输出纯 Markdown，不要包代码块。\n\n" +
          content,
        mode: "global",
      });
      setGlobalStatus("润色完成");
      return response.answer;
    } catch (error) {
      setGlobalStatus(`AI 润色失败：${getErrorMessage(error)}`);
      return content;
    }
  }

  async function handleGenerateCurrentSlideExplanation() {
    if (!upload.documentId || !currentSlide) return;
    setSlideGenerationLoading(true);
    setGlobalStatus("重新生成解析中…");
    try {
      const result = await generateSlideExplanation(upload.documentId, currentSlide.id);
      upload.setCachedExplanation(currentSlide.id, result);
      setExplanation(result.markdown);
      setExplanationMeta(result.meta ?? null);
      setGlobalStatus("解析已更新");
    } catch (error) {
      setGlobalStatus(`解析生成失败：${getErrorMessage(error)}`);
    } finally {
      setSlideGenerationLoading(false);
    }
  }

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

  const notebookSaveLabel =
    notebookSaveState === "saving"
      ? "自动保存中"
      : notebookSaveState === "saved"
        ? "已保存"
        : notebookSaveState === "error"
          ? "保存失败"
          : "已加载";

  return (
    <main className="relative flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="relative z-10 shrink-0 border-b border-[#d7c5aa] bg-[#fbf5eb]/85 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-2 md:px-5">
          <div className="flex items-center gap-2">
            {interactiveReady ? (
              <button
                className="flex h-8 w-8 flex-col items-center justify-center gap-1.5 rounded-xl border border-[#d7c5aa] bg-[#fffaf1] hover:bg-[#f5ebda] transition-colors"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                type="button"
                aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              >
                <span className="h-[1.5px] w-4 rounded-full bg-[#7c6348]" />
                <span className="h-[1.5px] w-4 rounded-full bg-[#7c6348]" />
                <span className="h-[1.5px] w-4 rounded-full bg-[#7c6348]" />
              </button>
            ) : (
              <div
                aria-hidden="true"
                className="h-8 w-8 rounded-xl border border-transparent"
              />
            )}
            <div>
              <p className="text-[9px] uppercase tracking-[0.28em] text-[#8c765f]">Learning Studio</p>
              <h1 className="text-sm font-semibold leading-tight text-[#463829]">幻灯片研习台</h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              aria-label={notePanelOpen ? "收起笔记本" : "打开笔记本"}
              className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[12px] font-medium transition-colors ${
                upload.documentId
                  ? notePanelOpen
                    ? "border-[#b59669] bg-[#ead6b8] text-[#553d20] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
                    : "border-[#d7c5aa] bg-[#fffaf1] text-[#5e4a34] hover:bg-[#f5ebda]"
                  : "cursor-not-allowed border-[#e5dac7] bg-[#f7f1e7] text-[#af9d86]"
              }`}
              data-testid="header-notebook-toggle"
              disabled={!upload.documentId}
              onClick={() => setNotePanelOpen((prev) => !prev)}
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
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span>{notePanelOpen ? "收起笔记" : "笔记本"}</span>
            </button>
            <div className="rounded-full border border-[#cbb998] bg-[#f5ebda] px-2.5 py-0.5 text-[11px] text-[#5f6d52]">
              {documentCount} 篇
            </div>
            {/* Global parse progress capsule replaces page badge while generating */}
            {upload.generationProgress ? (
              <div className="flex items-center gap-1.5 rounded-full border border-[#c9b07e] bg-[#fffbf0] px-3 py-0.5 shadow-sm">
                <span className="text-[10px] animate-pulse">✦</span>
                <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-[#ede3cf]">
                  <div
                    className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-gradient-to-r from-[#c9a97a] to-[#8a9d76] transition-transform duration-500 ease-out"
                    style={{ transform: `scaleX(${upload.generationProgress.current / upload.generationProgress.total})` }}
                  />
                </div>
                <span className="tabular-nums text-[10px] text-[#8c6c46]">
                  {upload.generationProgress.current}/{upload.generationProgress.total}
                </span>
              </div>
            ) : (
              <div className="rounded-full border border-[#d8bf94] bg-[#f7ecd6] px-2.5 py-0.5 text-[11px] text-[#8c6c46]">
                {currentSlide ? `P${currentSlide.page_num}/${pageCount || 0}` : "—"}
              </div>
            )}
            <div className="max-w-[300px] truncate rounded-full border border-[#dbc9ae] bg-[#fffaf1] px-2.5 py-0.5 text-[11px] text-[#746452]">
              {statusText}
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 overflow-hidden p-4 md:p-5">
        <aside
          className={`min-h-0 shrink-0 overflow-hidden rounded-[28px] border border-[#d9c7ab] bg-[#f7f0e3]/95 shadow-[0_20px_50px_rgba(109,85,58,0.12)] backdrop-blur-xl transition-all duration-300 ${
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
            notePanelOpen={notePanelOpen}
            onAbortGeneration={upload.abortGeneration}
            onCreateFolder={(name) => upload.createFolder(name)}
            onDeleteDocument={handleDeleteDocument}
            onDeleteFolder={handleDeleteFolder}
            onMoveDocument={upload.moveDocument}
            onRegenerateDocument={upload.regenerateDocumentExplanations}
            onSelectDocument={upload.loadDocument}
            onToggleNotes={() => setNotePanelOpen((prev) => !prev)}
            onUpload={upload.handleUpload}
          />
        </aside>

        <section className="grid h-full min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1.18fr_0.92fr]">
            <ErrorBoundary resetKey={upload.documentId}>
              <SlideViewer
                currentIndex={currentSlideIndex}
                onRoiChange={setRoi}
                onSelect={setCurrentSlideIndex}
                roi={roi}
                slides={upload.slides}
              />
            </ErrorBoundary>
            <ErrorBoundary resetKey={upload.documentId}>
              <AIPanel
                chatInput={chat.chatInput}
                chatMessages={chat.chatMessages}
                currentSlideId={currentSlide?.id}
                disabled={!currentSlide}
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
                onInsertToNotes={(text) => {
                  if (!currentSlide || !currentDocumentName) return;
                  const next = insertSelectionIntoNotebook({
                    markdown: notesMarkdownRef.current,
                    filename: currentDocumentName,
                    pageNum: currentSlide.page_num,
                    pageTitle: inferPageTitle({
                      fallbackPageNum: currentSlide.page_num,
                      explanationTitle: chat.explanationMeta?.title ?? null,
                      extractTitle: currentSlide.extract?.title_candidates?.[0] ?? null,
                    }),
                    selectedText: text,
                    sourceLabel: "当前页解析",
                  });
                  setNotePanelOpen(true);
                  if (!next.inserted) {
                    setGlobalStatus("该摘录已存在");
                    return;
                  }
                  updateNotesMarkdown(next.markdown);
                  setGlobalStatus("已加入笔记本");
                }}
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

      <NotebookWindow
        disabled={!upload.documentId}
        documentName={currentDocumentName}
        loading={loading || notebookSaving}
        markdown={notesMarkdown}
        onAIOrganize={() => void handleAutoGenerateNotes()}
        onAIPolish={handleAIPolishNotes}
        onChange={updateNotesMarkdown}
        onCollapse={() => setNotePanelOpen(false)}
        onExport={() => void handleExportNotes()}
        onFormat={() => {
          if (!currentDocumentName) return;
          updateNotesMarkdown(formatNotebookMarkdown(notesMarkdownRef.current, currentDocumentName));
          setGlobalStatus("笔记格式已整理");
        }}
        onViewModeChange={setNotebookViewMode}
        open={notePanelOpen}
        saveStateLabel={notebookSaveLabel}
        viewMode={notebookViewMode}
      />
    </main>
  );
}
