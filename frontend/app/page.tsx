"use client";

import { useEffect, useMemo, useState } from "react";

import { AIPanel } from "@/components/ai-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { SlideViewer } from "@/components/slide-viewer";
import { useChat } from "@/hooks/useChat";
import { useQuiz } from "@/hooks/useQuiz";
import { useReview } from "@/hooks/useReview";
import { useUpload } from "@/hooks/useUpload";
import { autogenNotes, exportDocumentExplanations, exportNotes, type RoiBox } from "@/lib/api";

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

  const review = useReview(setGlobalStatus);

  async function refreshInsights() {
    if (upload.sessionId) {
      await review.refresh(upload.sessionId);
    }
  }

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
    setGlobalStatus("");
    quiz.reset();
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
      return;
    }
    setExplanation(upload.cachedExplanations[currentSlide.id] ?? "");
  }, [currentSlide, upload.cachedExplanations, setExplanation]);

  const statusText =
    chat.statusText || upload.statusText || globalStatus || "就绪";

  const loading = upload.loading || chat.loading || quiz.loading || review.loading || notesLoading;

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
      const msg = error instanceof Error ? error.message : "未知错误";
      setGlobalStatus(`导出失败：${msg}`);
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
      const msg = error instanceof Error ? error.message : "未知错误";
      setGlobalStatus(`导出失败：${msg}`);
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
      const msg = error instanceof Error ? error.message : "未知错误";
      setGlobalStatus(`自动笔记生成失败：${msg}`);
    } finally {
      setNotesLoading(false);
    }
  }

  function handleAppendSelectionToNotes() {
    const selection = window.getSelection()?.toString().trim();
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

  function handleLoadCachedExplanation() {
    if (!currentSlide) return;
    setExplanation(upload.cachedExplanations[currentSlide.id] ?? "");
  }

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-slate-100">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
        <div className="flex items-center gap-2">
          <button
            className="btn btn-outline !rounded-lg !px-3 !py-1.5 text-[11px]"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            type="button"
          >
            {sidebarCollapsed ? "展开" : "收起"}
          </button>
          <h1 className="text-sm font-semibold text-slate-800 md:text-base">PPT 学习工作台</h1>
        </div>
        <p className="max-w-[60%] truncate text-xs text-slate-600">{statusText}</p>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`border-r border-slate-200 bg-white transition-all duration-200 ${
            sidebarCollapsed ? "w-16" : "w-72"
          }`}
        >
          <div className="flex h-full flex-col p-2">
            <label
              className={`btn btn-dark mb-2 inline-flex cursor-pointer text-xs ${
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
                <p className="mb-2 px-1 text-xs font-medium text-slate-500">已上传文档</p>
                <div className="flex-1 space-y-1 overflow-auto">
                  {upload.documents.length === 0 ? (
                    <p className="px-2 text-xs text-slate-400">暂无文档</p>
                  ) : (
                    upload.documents.map((doc) => (
                      <button
                        className={`w-full rounded-xl border px-2.5 py-2.5 text-left text-xs transition ${
                          upload.documentId === doc.id
                            ? "border-cyan-300 bg-gradient-to-r from-cyan-50 to-teal-50 text-slate-800 shadow-sm"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                        key={doc.id}
                        onClick={() => void upload.loadDocument(doc.id)}
                        type="button"
                      >
                        <p className="truncate font-medium">{doc.filename}</p>
                        <p className="mt-1 text-[10px] opacity-80">
                          {doc.status} · {doc.page_count} 页
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>
        </aside>

        <section className="min-h-0 flex-1">
          <section className="grid h-full min-h-0 grid-cols-1 gap-0 lg:grid-cols-[1.2fr_1fr]">
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
                onGenerateExplanation={handleLoadCachedExplanation}
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
        </section>
      </div>
    </main>
  );
}
