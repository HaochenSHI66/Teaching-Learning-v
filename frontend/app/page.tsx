"use client";

import { useEffect, useMemo, useState } from "react";

import { AIPanel } from "@/components/ai-panel";
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
          <div className="flex h-full flex-col p-3">
            <div className="mb-3 rounded-[22px] border border-[#e4d8c5] bg-[#fffaf1] p-3">
              <p className="text-[10px] uppercase tracking-[0.26em] text-[#9d876f]">Document Dock</p>
              <p className="mt-2 text-sm font-medium text-[#463829]">资料库</p>
              <p className="mt-1 text-xs leading-5 text-[#877563]">
                上传文档后自动生成解析缓存，支持多文档切换。
              </p>
            </div>

            <label
              className={`btn btn-primary mb-3 inline-flex cursor-pointer text-xs ${
                loading ? "opacity-70" : ""
              }`}
            >
              <span>上传 PDF/图片</span>
              <input
                accept=".pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={loading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload.handleUpload(file);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>

            <>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#9a846a]">文档库</p>
                <span className="text-[11px] text-[#9a846a]">{documentCount} 份</span>
              </div>
              <div className="flex-1 space-y-2 overflow-auto pr-1">
                {upload.documents.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-[#dbc8ad] bg-[#fffaf2] px-4 py-5 text-sm text-[#8b7764]">
                    暂无文档。上传 PDF 后显示。
                  </div>
                ) : (
                  upload.documents.map((doc) => (
                    <article
                      className={`rounded-[22px] border p-3 transition ${
                        upload.documentId === doc.id
                          ? "border-[#cab384] bg-[linear-gradient(135deg,#fff8ec_0%,#f2e7d2_62%,#ece4d5_100%)] shadow-[0_18px_36px_rgba(122,98,66,0.12)]"
                          : "border-[#e0d1bc] bg-[#fffaf2] hover:border-[#cdb796] hover:bg-white"
                      }`}
                      key={doc.id}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={() => void upload.loadDocument(doc.id)}
                          type="button"
                        >
                          <p className="truncate text-sm font-medium text-[#463829]">{doc.filename}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#86715b]">
                            <span className="rounded-full bg-[#f1e6d4] px-2 py-1">{doc.page_count} 页</span>
                            <span
                              className={`rounded-full px-2 py-1 ${
                                doc.status === "ready"
                                  ? "bg-[#e8efe0] text-[#607253]"
                                  : doc.status === "processing"
                                    ? "bg-[#f7ecd7] text-[#8c6c46]"
                                    : "bg-[#f5e3dc] text-[#9a5e4e]"
                              }`}
                            >
                              {doc.status}
                            </span>
                          </div>
                        </button>
                        <button
                          className="btn btn-outline !rounded-full !px-2.5 !py-1 text-[11px] !text-[#9a5e4e] hover:!border-[#d0a193] hover:!bg-[#f5e3dc]"
                          disabled={loading}
                          onClick={() => void handleDeleteDocument(doc.id, doc.filename)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                      <div className="mt-3 flex flex-col gap-2">
                        {upload.generationDocId === doc.id ? (
                          <>
                            <div className="flex items-center justify-between text-[11px] text-[#7a6655]">
                              <span>
                                {upload.generationProgress
                                  ? `${upload.generationProgress.current} / ${upload.generationProgress.total} 页`
                                  : "准备中…"}
                              </span>
                              <button
                                className="btn btn-outline !rounded-full !px-2.5 !py-0.5 !text-[10px] !text-[#9a5e4e] hover:!border-[#d0a193] hover:!bg-[#f5e3dc]"
                                onClick={upload.abortGeneration}
                                type="button"
                              >
                                终止
                              </button>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ede3d3]">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#c9a97a] to-[#8a9d76] transition-all duration-300"
                                style={{
                                  width: upload.generationProgress
                                    ? `${(upload.generationProgress.current / upload.generationProgress.total) * 100}%`
                                    : "0%",
                                }}
                              />
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              className="btn btn-soft flex-1 !rounded-full !py-2 text-[11px]"
                              disabled={loading || doc.status !== "ready"}
                              onClick={() => void upload.regenerateDocumentExplanations(doc.id)}
                              type="button"
                            >
                              生成解析
                            </button>
                            {upload.documentId === doc.id && (
                              <button
                                className={`btn !rounded-full !py-2 !px-3 text-[11px] ${notePanelOpen ? "btn-dark" : "btn-soft"}`}
                                onClick={() => setNotePanelOpen((prev) => !prev)}
                                type="button"
                              >
                                笔记
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          </div>
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
