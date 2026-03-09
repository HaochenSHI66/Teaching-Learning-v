"use client";

import { useEffect, useMemo, useState } from "react";

import { AIPanel } from "@/components/ai-panel";
import { DocumentLibrary } from "@/components/document-library";
import { ErrorBoundary } from "@/components/error-boundary";
import { NoteEditor } from "@/components/note-editor";
import { SlideViewer } from "@/components/slide-viewer";
import { useChat } from "@/hooks/useChat";
import { useUpload } from "@/hooks/useUpload";
import {
  askSlideQuestion,
  autogenNotes,
  exportDocumentExplanations,
  exportNotes,
  generateSlideExplanation,
  type RoiBox,
} from "@/lib/api";
import { getErrorMessage } from "@/lib/errorMessage";

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

function formatNotesMarkdown(input: string) {
  const trimmed = input.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!trimmed) {
    return "# 笔记\n\n";
  }
  if (trimmed.startsWith("#")) {
    return `${trimmed}\n`;
  }
  return `# 笔记\n\n${trimmed}\n`;
}

export default function Page() {
  const upload = useUpload();
  const chat = useChat();
  const { setExplanation, setExplanationMeta } = chat;

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [roi, setRoi] = useState<RoiBox | null>(null);
  const [notesMarkdown, setNotesMarkdown] = useState("");
  const [globalStatus, setGlobalStatus] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [slideGenerationLoading, setSlideGenerationLoading] = useState(false);
  const [notePanelOpen, setNotePanelOpen] = useState(false);

  const currentSlide = useMemo(
    () => upload.slides[currentSlideIndex],
    [upload.slides, currentSlideIndex],
  );

  useEffect(() => {
    setCurrentSlideIndex(0);
    setRoi(null);
    setNotesMarkdown("");
    setGlobalStatus("");
    chat.setChatInput("");
    chat.clearStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.documentId]);

  useEffect(() => {
    setRoi(null);
  }, [currentSlideIndex]);

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
    upload.loading || chat.loading || notesLoading || slideGenerationLoading;
  const documentCount = upload.documents.length;
  const pageCount = upload.slides.length;

  async function handleExportNotes() {
    if (!upload.sessionId) return;
    setNotesLoading(true);
    setGlobalStatus("导出会话笔记中…");
    try {
      const result = await exportNotes({ sessionId: upload.sessionId, title: "会话笔记" });
      setNotesMarkdown(result.markdown);
      downloadMarkdown("session-notes.md", result.markdown);
      setGlobalStatus("笔记已导出");
    } catch (error) {
      setGlobalStatus(`导出失败：${getErrorMessage(error)}`);
    } finally {
      setNotesLoading(false);
    }
  }

  async function handleExportAllExplanations() {
    if (!upload.documentId) return;
    setNotesLoading(true);
    setGlobalStatus("导出解析中…");
    try {
      const result = await exportDocumentExplanations(upload.documentId);
      setNotesMarkdown(result.markdown);
      downloadMarkdown("all-slides-explanations.md", result.markdown);
      setGlobalStatus("解析已导出");
    } catch (error) {
      setGlobalStatus(`导出失败：${getErrorMessage(error)}`);
    } finally {
      setNotesLoading(false);
    }
  }

  async function handleAutoGenerateNotes() {
    if (!upload.sessionId) return;
    setNotesLoading(true);
    setGlobalStatus("生成结构化笔记中…");
    try {
      const result = await autogenNotes({ sessionId: upload.sessionId, title: "自动笔记" });
      setNotesMarkdown(result.markdown);
      setGlobalStatus("笔记已生成");
    } catch (error) {
      setGlobalStatus(`笔记生成失败：${getErrorMessage(error)}`);
    } finally {
      setNotesLoading(false);
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
        message: `请优化整理以下学习笔记，改善结构与表达，保留所有核心要点，以 Markdown 格式输出：\n\n${content}`,
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

  async function handleDeleteDocument(targetDocumentId: string, filename: string) {
    const confirmed = window.confirm(`确认删除《${filename}》？该操作将清除缓存与会话记录。`);
    if (!confirmed) return;
    await upload.deleteDocument(targetDocumentId);
  }

  return (
    <main className="relative flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="relative z-10 shrink-0 border-b border-[#d7c5aa] bg-[#fbf5eb]/85 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-4 py-2 md:px-5">
          <div className="flex items-center gap-2">
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
            <div>
              <p className="text-[9px] uppercase tracking-[0.28em] text-[#8c765f]">Learning Studio</p>
              <h1 className="text-sm font-semibold leading-tight text-[#463829]">幻灯片研习台</h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="rounded-full border border-[#cbb998] bg-[#f5ebda] px-2.5 py-0.5 text-[11px] text-[#5f6d52]">
              {documentCount} 篇
            </div>
            <div className="rounded-full border border-[#d8bf94] bg-[#f7ecd6] px-2.5 py-0.5 text-[11px] text-[#8c6c46]">
              {currentSlide ? `P${currentSlide.page_num}/${pageCount || 0}` : "—"}
            </div>
            <div className="max-w-[300px] truncate rounded-full border border-[#dbc9ae] bg-[#fffaf1] px-2.5 py-0.5 text-[11px] text-[#746452]">
              {statusText}
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 overflow-hidden p-4 md:p-5">
        <aside
          className={`min-h-0 overflow-hidden rounded-[28px] border border-[#d9c7ab] bg-[#f7f0e3]/95 shadow-[0_20px_50px_rgba(109,85,58,0.12)] backdrop-blur-xl transition-all duration-300 ${
            sidebarCollapsed ? "w-0 p-0 border-0 opacity-0 pointer-events-none" : "w-[320px]"
          }`}
        >
          <DocumentLibrary
            activeDocumentId={upload.documentId}
            generationDocId={upload.generationDocId}
            generationProgress={upload.generationProgress}
            library={upload.library}
            loading={loading}
            notePanelOpen={notePanelOpen}
            onAbortGeneration={upload.abortGeneration}
            onCreateFolder={(name) => upload.createFolder(name)}
            onDeleteDocument={handleDeleteDocument}
            onMoveDocument={upload.moveDocument}
            onRegenerateDocument={upload.regenerateDocumentExplanations}
            onSelectDocument={upload.loadDocument}
            onToggleNotes={() => setNotePanelOpen((prev) => !prev)}
            onUpload={upload.handleUpload}
          />
        </aside>

        <section className="grid h-full min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1.18fr_0.92fr]">
            <ErrorBoundary>
              <SlideViewer
                currentIndex={currentSlideIndex}
                onRoiChange={setRoi}
                onSelect={setCurrentSlideIndex}
                roi={roi}
                slides={upload.slides}
              />
            </ErrorBoundary>
            <ErrorBoundary>
              {notePanelOpen ? (
                <NoteEditor
                  markdown={notesMarkdown}
                  onChange={setNotesMarkdown}
                  onFormat={() => setNotesMarkdown((prev) => formatNotesMarkdown(prev))}
                  onAIOrganize={() => void handleAutoGenerateNotes()}
                  onAIPolish={handleAIPolishNotes}
                  onExport={() => void handleExportNotes()}
                  loading={loading}
                  disabled={!currentSlide}
                  documentName={upload.documents.find((d) => d.id === upload.documentId)?.filename}
                />
              ) : (
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
                    setNotesMarkdown((prev) => {
                      const quoted = text
                        .split("\n")
                        .map((line) => `> ${line}`)
                        .join("\n");
                      const prefix = prev.trim() ? `${prev.trimEnd()}\n\n` : "# 笔记\n\n";
                      return `${prefix}## 摘录\n${quoted}\n`;
                    });
                    setGlobalStatus("已摘录");
                  }}
                  onModeChange={chat.setMode}
                  onSendChat={() => {
                    const message = chat.chatInput;
                    chat.setChatInput("");
                    if (upload.sessionId) void chat.ask(message, upload.sessionId, currentSlide);
                  }}
                  roiReady={Boolean(roi)}
                />
              )}
            </ErrorBoundary>
        </section>
      </div>
    </main>
  );
}
