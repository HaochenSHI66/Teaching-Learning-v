"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AIPanel } from "@/components/ai-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { SlideViewer } from "@/components/slide-viewer";
import { useChat } from "@/hooks/useChat";
import { useQuiz } from "@/hooks/useQuiz";
import { useReview } from "@/hooks/useReview";
import { useUpload } from "@/hooks/useUpload";
import {
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
    return "# 学习笔记\n\n- [ ] 补充核心结论\n- [ ] 补充易错点\n- [ ] 补充一题练习\n";
  }
  if (trimmed.startsWith("#")) {
    return `${trimmed}\n`;
  }
  return `# 学习笔记\n\n${trimmed}\n`;
}

export default function Page() {
  const upload = useUpload();
  const chat = useChat();
  const { setExplanation } = chat;

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [roi, setRoi] = useState<RoiBox | null>(null);
  const [notesMarkdown, setNotesMarkdown] = useState("");
  const [globalStatus, setGlobalStatus] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [slideGenerationLoading, setSlideGenerationLoading] = useState(false);
  const [selectedExplanationText, setSelectedExplanationText] = useState("");

  const review = useReview(setGlobalStatus);

  const refreshInsights = useCallback(async () => {
    if (upload.sessionId) {
      await review.refresh(upload.sessionId);
    }
  // review.refresh is recreated each render but closes over only stable setters
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.sessionId]);

  const quiz = useQuiz(setGlobalStatus, refreshInsights);

  const currentSlide = useMemo(
    () => upload.slides[currentSlideIndex],
    [upload.slides, currentSlideIndex],
  );

  useEffect(() => {
    if (upload.sessionId) {
      void review.refresh(upload.sessionId);
    }
  }, [upload.sessionId]);

  useEffect(() => {
    setCurrentSlideIndex(0);
    setRoi(null);
    setNotesMarkdown("");
    setSelectedExplanationText("");
    setGlobalStatus("");
    quiz.reset();
    chat.setChatInput("");
    chat.clearStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.documentId]);

  useEffect(() => {
    setRoi(null);
    setSelectedExplanationText("");
  }, [currentSlideIndex]);

  useEffect(() => {
    function handleSelectionChange() {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      const anchorElement =
        selection?.anchorNode instanceof Element
          ? selection.anchorNode
          : selection?.anchorNode?.parentElement ?? null;
      const inExplanation =
        anchorElement?.closest?.("[data-note-source='explanation-content']") ?? null;

      if (inExplanation && text) {
        setSelectedExplanationText(text);
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  useEffect(() => {
    if (!currentSlide) {
      setExplanation("");
      return;
    }
    setExplanation(upload.cachedExplanations[currentSlide.id] ?? "");
  }, [currentSlide, upload.cachedExplanations, setExplanation]);

  const statusText =
    chat.statusText || upload.statusText || globalStatus || "就绪";

  const loading =
    upload.loading || chat.loading || quiz.loading || review.loading || notesLoading || slideGenerationLoading;
  const documentCount = upload.documents.length;
  const pageCount = upload.slides.length;

  async function handleExportNotes() {
    if (!upload.sessionId) return;
    setNotesLoading(true);
    setGlobalStatus("正在导出会话笔记...");
    try {
      const result = await exportNotes({ sessionId: upload.sessionId, title: "会话笔记" });
      setNotesMarkdown(result.markdown);
      downloadMarkdown("session-notes.md", result.markdown);
      setGlobalStatus("会话笔记导出完成");
    } catch (error) {
      setGlobalStatus(`导出失败：${getErrorMessage(error)}`);
    } finally {
      setNotesLoading(false);
    }
  }

  async function handleExportAllExplanations() {
    if (!upload.documentId) return;
    setNotesLoading(true);
    setGlobalStatus("正在导出整套讲解...");
    try {
      const result = await exportDocumentExplanations(upload.documentId);
      setNotesMarkdown(result.markdown);
      downloadMarkdown("all-slides-explanations.md", result.markdown);
      setGlobalStatus("整套讲解导出完成");
    } catch (error) {
      setGlobalStatus(`导出失败：${getErrorMessage(error)}`);
    } finally {
      setNotesLoading(false);
    }
  }

  async function handleAutoGenerateNotes() {
    if (!upload.sessionId) return;
    setNotesLoading(true);
    setGlobalStatus("正在生成自动笔记...");
    try {
      const result = await autogenNotes({ sessionId: upload.sessionId, title: "自动笔记" });
      setNotesMarkdown(result.markdown);
      setGlobalStatus("自动笔记已生成，可继续手动补充");
    } catch (error) {
      setGlobalStatus(`自动笔记生成失败：${getErrorMessage(error)}`);
    } finally {
      setNotesLoading(false);
    }
  }

  function handleAppendSelectionToNotes() {
    const selection = selectedExplanationText.trim();
    if (!selection) {
      setGlobalStatus("请先在讲解区域选中文本再添加。");
      return;
    }
    setNotesMarkdown((prev) => {
      const quoted = selection
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      const prefix = prev.trim() ? `${prev.trimEnd()}\n\n` : "# 学习笔记\n\n";
      return `${prefix}## 选中摘录\n${quoted}\n`;
    });
    setGlobalStatus("已把选中内容加入笔记。");
  }

  async function handleGenerateCurrentSlideExplanation() {
    if (!upload.documentId || !currentSlide) return;
    setSlideGenerationLoading(true);
    setGlobalStatus("正在覆盖生成当前页讲解...");
    try {
      const result = await generateSlideExplanation(upload.documentId, currentSlide.id);
      upload.setCachedExplanation(currentSlide.id, result.markdown);
      setExplanation(result.markdown);
      setGlobalStatus("当前页讲解已重新生成并覆盖缓存。");
    } catch (error) {
      setGlobalStatus(`当前页生成失败：${getErrorMessage(error)}`);
    } finally {
      setSlideGenerationLoading(false);
    }
  }

  async function handleDeleteDocument(targetDocumentId: string, filename: string) {
    const confirmed = window.confirm(`确定删除《${filename}》吗？这会移除缓存讲解、会话记录和本地文件。`);
    if (!confirmed) return;
    await upload.deleteDocument(targetDocumentId);
  }

  return (
    <main className="relative flex h-screen min-h-screen flex-col overflow-hidden">
      <header className="relative z-10 border-b border-[#d7c5aa] bg-[#fbf5eb]/85 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <button
              className="btn btn-outline !rounded-full !px-3 !py-2 text-[11px]"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              type="button"
            >
              {sidebarCollapsed ? "展开面板" : "收起面板"}
            </button>
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-[#8c765f]">Learning Studio</p>
              <h1 className="text-xl font-semibold text-[#463829] md:text-2xl">PPT 学习工作台</h1>
              <p className="text-xs text-[#8a7866]">逐页理解、即时提问、把讲解沉淀成可复习笔记。</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-[#cbb998] bg-[#f5ebda] px-3 py-1 text-xs text-[#5f6d52]">
              文档 {documentCount}
            </div>
            <div className="rounded-full border border-[#d8bf94] bg-[#f7ecd6] px-3 py-1 text-xs text-[#8c6c46]">
              当前页 {currentSlide ? `${currentSlide.page_num}/${pageCount || 0}` : "未选择"}
            </div>
            <div className="max-w-[360px] truncate rounded-full border border-[#dbc9ae] bg-[#fffaf1] px-3 py-1 text-xs text-[#746452]">
              {statusText}
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 overflow-hidden p-4 md:p-5">
        <aside
          className={`min-h-0 overflow-hidden rounded-[28px] border border-[#d9c7ab] bg-[#f7f0e3]/95 shadow-[0_20px_50px_rgba(109,85,58,0.12)] backdrop-blur-xl transition-all duration-300 ${
            sidebarCollapsed ? "w-[84px]" : "w-[320px]"
          }`}
        >
          <div className="flex h-full flex-col p-3">
            <div className={`mb-3 rounded-[22px] border border-[#e4d8c5] bg-[#fffaf1] p-3 ${sidebarCollapsed ? "text-center" : ""}`}>
              <p className="text-[10px] uppercase tracking-[0.26em] text-[#9d876f]">
                {sidebarCollapsed ? "Doc" : "Document Dock"}
              </p>
              {!sidebarCollapsed ? (
                <>
                  <p className="mt-2 text-sm font-medium text-[#463829]">资料库</p>
                  <p className="mt-1 text-xs leading-5 text-[#877563]">
                    上传后自动生成整套讲解缓存，侧栏支持切换与删除。
                  </p>
                </>
              ) : null}
            </div>

            <label
              className={`btn btn-primary mb-3 inline-flex cursor-pointer text-xs ${
                loading ? "opacity-70" : ""
              }`}
            >
              <span>{sidebarCollapsed ? "上传" : "上传 PDF/图片"}</span>
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

            {!sidebarCollapsed ? (
              <>
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#9a846a]">已上传文档</p>
                  <span className="text-[11px] text-[#9a846a]">{documentCount} 份</span>
                </div>
                <div className="flex-1 space-y-2 overflow-auto pr-1">
                  {upload.documents.length === 0 ? (
                    <div className="rounded-[22px] border border-dashed border-[#dbc8ad] bg-[#fffaf2] px-4 py-5 text-sm text-[#8b7764]">
                      暂无文档。上传一份 PDF 后，这里会显示你的学习资料库。
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
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            className="btn btn-soft w-full !rounded-full !py-2 text-[11px]"
                            disabled={loading || doc.status !== "ready"}
                            onClick={() => void upload.regenerateDocumentExplanations(doc.id)}
                            type="button"
                          >
                            整份生成讲解
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="mt-2 flex flex-1 flex-col items-center gap-3 text-[11px] text-[#8f7b68]">
                <div className="rounded-full border border-[#ddccaf] bg-[#fffaf1] px-3 py-2">{documentCount}</div>
                <div className="rounded-full border border-[#ddccaf] bg-[#fffaf1] px-3 py-2">{pageCount}</div>
              </div>
            )}
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
              <AIPanel
                analytics={review.analytics}
                chatInput={chat.chatInput}
                chatMessages={chat.chatMessages}
                disabled={!currentSlide}
                explanationState={currentSlide?.explanation_state ?? "not_generated"}
                explanationLoading={slideGenerationLoading}
                extraction={currentSlide?.extract ?? null}
                explanation={chat.explanation}
                loading={loading}
                mode={chat.mode}
                notesMarkdown={notesMarkdown}
                onAutoGenerateNotes={() => void handleAutoGenerateNotes()}
                onChatInputChange={chat.setChatInput}
                onCompleteReview={(reviewId, quality) => {
                  if (upload.sessionId) void review.complete(reviewId, quality, upload.sessionId);
                }}
                onExplainRoi={() => {
                  if (currentSlide && roi && upload.sessionId) {
                    void chat.askRoi(roi, upload.sessionId, currentSlide);
                  }
                }}
                onExportAllExplanations={() => void handleExportAllExplanations()}
                onExportNotes={() => void handleExportNotes()}
                onFormatNotes={() => setNotesMarkdown((prev) => formatNotesMarkdown(prev))}
                onGenerateExplanation={() => void handleGenerateCurrentSlideExplanation()}
                onGenerateQuiz={() => {
                  if (upload.sessionId && currentSlide) {
                    void quiz.generate(upload.sessionId, currentSlide.id);
                  }
                }}
                onModeChange={chat.setMode}
                onNotesChange={setNotesMarkdown}
                onAppendSelectionToNotes={handleAppendSelectionToNotes}
                onQuizAnswerChange={quiz.setAnswer}
                onRefreshReview={() => {
                  if (upload.sessionId) void review.refresh(upload.sessionId);
                }}
                onSendChat={() => {
                  const message = chat.chatInput;
                  chat.setChatInput("");
                  if (upload.sessionId) void chat.ask(message, upload.sessionId, currentSlide);
                }}
                onSubmitQuiz={() => void quiz.submit()}
                quizAnswers={quiz.quizAnswers}
                quizFeedback={quiz.quizFeedback}
                quizQuestions={quiz.quizQuestions}
                reviewItems={review.reviewItems}
                roiReady={Boolean(roi)}
              />
            </ErrorBoundary>
        </section>
      </div>
    </main>
  );
}
