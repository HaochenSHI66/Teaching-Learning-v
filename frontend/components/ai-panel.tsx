"use client";

import { useState } from "react";

import { MarkdownContent } from "@/components/markdown-content";
import type { ChatMessage } from "@/hooks/useChat";
import type { QuizQuestion, ReviewItem, SessionAnalyticsPayload, SlideExtract } from "@/lib/api";

type AIPanelProps = {
  disabled: boolean;
  explanation: string;
  explanationLoading: boolean;
  explanationState: "not_generated" | "ready" | "generating" | "error";
  extraction: SlideExtract | null;
  loading: boolean;
  chatInput: string;
  chatMessages: ChatMessage[];
  currentSlideId?: string;
  notesMarkdown: string;
  mode: "slide" | "global";
  roiReady: boolean;
  quizQuestions: QuizQuestion[];
  quizAnswers: Record<string, string>;
  quizFeedback: string;
  reviewItems: ReviewItem[];
  analytics: SessionAnalyticsPayload | null;
  onModeChange: (mode: "slide" | "global") => void;
  onChatInputChange: (value: string) => void;
  onSendChat: () => void;
  onGenerateExplanation: () => void;
  onExplainRoi: () => void;
  onExportNotes: () => void;
  onExportAllExplanations: () => void;
  onAutoGenerateNotes: () => void;
  onAppendSelectionToNotes: () => void;
  onFormatNotes: () => void;
  onNotesChange: (value: string) => void;
  onGenerateQuiz: () => void;
  onQuizAnswerChange: (questionId: string, answer: string) => void;
  onSubmitQuiz: () => void;
  onRefreshReview: () => void;
  onCompleteReview: (reviewId: string, quality: number) => void;
  onClearSlideMessages: () => void;
};

const TABS = [
  { key: "explain", label: "解析" },
  { key: "extract", label: "结构" },
  { key: "chat", label: "追问" },
  { key: "notes", label: "笔记" },
  { key: "quiz", label: "测验" },
  { key: "review", label: "复习" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const QUALITY_LABELS: { quality: number; label: string; className: string }[] = [
  { quality: 0, label: "完全不会", className: "btn btn-quality-danger" },
  { quality: 2, label: "模糊记得", className: "btn btn-quality-warn" },
  { quality: 4, label: "基本掌握", className: "btn btn-quality-ok" },
  { quality: 5, label: "完全掌握", className: "btn btn-quality-done" },
];

function buildExtractionMarkdown(extraction: SlideExtract | null) {
  if (!extraction) {
    return "> [!NOTE]\n> 当前页尚未提取出结构化内容。";
  }

  const lines = [
    "> [!NOTE]",
    "> 非大模型提取结果，可用于定位页面结构、图块与阅读顺序。",
    "",
    `**摘要**：${extraction.summary || "本页以图像或版面结构为主，暂无稳定文本摘要。"}`,
    "",
    "### 页面统计",
    `- 文本块：**${extraction.page_stats.text_block_count ?? 0}**`,
    `- 图示区域：**${extraction.page_stats.figure_count ?? 0}**`,
    `- 表格：**${extraction.page_stats.table_count ?? 0}**`,
  ];

  if (extraction.title_candidates.length > 0) {
    lines.push("", "### 标题候选", ...extraction.title_candidates.slice(0, 3).map((t) => `- ${t}`));
  }
  if (extraction.text_blocks.length > 0) {
    lines.push("", "### 文本块");
    for (const b of extraction.text_blocks.slice(0, 5)) {
      lines.push(`- **${b.type}**: ${b.text ?? ""}`);
    }
  }
  if (extraction.figures.length > 0) {
    lines.push("", "### 图示区域");
    for (const f of extraction.figures) lines.push(`- **${f.label ?? f.id}**`);
  }

  return lines.join("\n");
}

function getExplanationBadge(
  explanationState: AIPanelProps["explanationState"],
  explanationLoading: boolean,
) {
  if (explanationLoading) return { label: "生成中", cls: "bg-[#f7ecd6] text-[#8c6c46] border-[#d8bf94]" };
  switch (explanationState) {
    case "ready":      return { label: "已缓存", cls: "bg-[#e8efe0] text-[#607253] border-[#c8d5b9]" };
    case "error":      return { label: "失败",   cls: "bg-[#f5e3dc] text-[#9a5e4e] border-[#e0b5a7]" };
    case "generating": return { label: "生成中", cls: "bg-[#f7ecd6] text-[#8c6c46] border-[#d8bf94]" };
    default:           return { label: "未生成", cls: "bg-[#efe7dc] text-[#826f5c] border-[#ddcfbc]" };
  }
}

export function AIPanel({
  disabled,
  explanation,
  explanationLoading,
  explanationState,
  extraction,
  loading,
  chatInput,
  chatMessages,
  currentSlideId,
  notesMarkdown,
  mode,
  roiReady,
  quizQuestions,
  quizAnswers,
  quizFeedback,
  reviewItems,
  analytics,
  onModeChange,
  onChatInputChange,
  onSendChat,
  onGenerateExplanation,
  onExplainRoi,
  onExportNotes,
  onExportAllExplanations,
  onAutoGenerateNotes,
  onAppendSelectionToNotes,
  onFormatNotes,
  onNotesChange,
  onGenerateQuiz,
  onQuizAnswerChange,
  onSubmitQuiz,
  onRefreshReview,
  onCompleteReview,
  onClearSlideMessages,
}: AIPanelProps) {
  const [tab, setTab] = useState<TabKey>("explain");
  const badge = getExplanationBadge(explanationState, explanationLoading);
  const extractionMarkdown = buildExtractionMarkdown(extraction);

  const slideMessages = currentSlideId
    ? chatMessages.filter((m) => m.slideId === currentSlideId)
    : chatMessages;

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[30px] border border-[#d9c7ab] bg-[linear-gradient(180deg,#fffaf2,#f6ebdb)] p-3 shadow-[0_28px_60px_rgba(122,98,66,0.12)]">
      {/* Tab bar */}
      <header className="mb-2 shrink-0">
        <div className="inline-flex flex-wrap gap-0.5 rounded-full border border-[#e0d0bb] bg-[#fffdf8] p-0.5 shadow-sm">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`btn btn-segment !px-3 !py-1.5 !text-[11px] ${tab === item.key ? "btn-segment-active" : "btn-segment-idle"}`}
              onClick={() => setTab(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* ── 解析 ─────────────────────────────────────── */}
      {tab === "explain" && (
        <section className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-[#e0d0bb] bg-[#fffdf8]">
          <header className="shrink-0 flex items-center justify-between gap-2 border-b border-[#eee2cf] px-3 py-2">
            <p className="text-[11px] font-medium text-[#4b3d2f]">当前页 AI 解析</p>
            <div className="flex items-center gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
              <button
                className="btn btn-primary !px-3 !py-1.5 !text-[11px]"
                disabled={disabled || loading}
                onClick={onGenerateExplanation}
                type="button"
              >
                {explanationLoading ? "生成中…" : "生成解析"}
              </button>
            </div>
          </header>

          {explanationLoading && (
            <div className="shrink-0 border-b border-[#eee2cf] px-3 py-2">
              <div className="mb-1 flex items-center justify-between text-[10px] text-[#9a7e63]">
                <span>正在调用 AI，请稍候…</span>
                <span className="animate-pulse">●</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-[#ede3d3]">
                <div className="h-full w-1/2 animate-[slide_1.6s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[#c9a97a] via-[#e8c98a] to-[#c9a97a]" />
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto p-3" data-note-source="explanation-content">
            {explanation ? (
              <MarkdownContent content={explanation} />
            ) : (
              <MarkdownContent
                content={
                  "> [!NOTE]\n> 当前页 AI 解析尚未生成。\n> 可先切换到「结构」标签查看提取内容，再点击「生成解析」。"
                }
              />
            )}
          </div>
        </section>
      )}

      {/* ── 结构 ─────────────────────────────────────── */}
      {tab === "extract" && (
        <div className="min-h-0 flex-1 overflow-auto rounded-[22px] border border-[#ddcfbc] bg-[#fffdf8] p-3">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[11px] font-medium text-[#4b3d2f]">页面结构提取</p>
            <span className="rounded-full border border-[#ddcfbc] bg-[#f4ecdf] px-2 py-0.5 text-[9px] text-[#7e6a57]">Non-LLM</span>
          </div>
          <MarkdownContent content={extractionMarkdown} />
          {extraction?.figures?.length ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {extraction.figures.map((figure) => (
                <article className="rounded-[16px] border border-[#e3d6c3] bg-white p-2.5 shadow-sm" key={figure.id}>
                  {figure.preview_image_url ? (
                    <img
                      alt={figure.label ?? figure.id}
                      className="mb-1.5 h-24 w-full rounded-[12px] object-cover"
                      src={figure.preview_image_url}
                    />
                  ) : null}
                  <p className="text-[11px] font-medium text-[#4f4031]">{figure.label ?? figure.id}</p>
                  <p className="mt-0.5 text-[10px] text-[#8a7764]">
                    bbox: {figure.bbox.map((v) => v.toFixed(0)).join(", ")}
                  </p>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* ── 追问 ─────────────────────────────────────── */}
      {tab === "chat" && (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          {/* Mode toggle */}
          <div className="shrink-0 flex items-center justify-between rounded-[16px] border border-[#e0d0bb] bg-[#fffdf8] px-2.5 py-1.5">
            <span className="text-[10px] text-[#9a846a]">提问范围</span>
            <div className="inline-flex rounded-full border border-[#e0d0bb] bg-[#f5ece0] p-0.5">
              <button
                className={`btn btn-segment !px-2.5 !py-1 !text-[10px] ${mode === "slide" ? "btn-segment-active" : "btn-segment-idle"}`}
                onClick={() => onModeChange("slide")}
                type="button"
              >
                当前页
              </button>
              <button
                className={`btn btn-segment !px-2.5 !py-1 !text-[10px] ${mode === "global" ? "btn-segment-active" : "btn-segment-idle"}`}
                onClick={() => onModeChange("global")}
                type="button"
              >
                全局
              </button>
            </div>
          </div>

          {/* Collapsible history */}
          <details className="shrink-0 overflow-hidden rounded-[16px] border border-[#e0d0bb] bg-[#fffdf8]" open={slideMessages.length > 0}>
            <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[10px] text-[#9a846a] hover:bg-[#f8f2e8]">
              <span>本页追问记录（{Math.floor(slideMessages.length / 2)} 轮）</span>
              <button
                className="btn btn-outline !rounded-lg !px-2 !py-0.5 !text-[10px]"
                disabled={slideMessages.length === 0}
                onClick={(e) => { e.preventDefault(); onClearSlideMessages(); }}
                type="button"
              >
                清空
              </button>
            </summary>
            <div className="max-h-44 space-y-1.5 overflow-auto border-t border-[#eee2cf] px-3 py-2">
              {slideMessages.length === 0 ? (
                <p className="text-[11px] text-[#b09a87]">暂无本页追问记录。</p>
              ) : (
                slideMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-[12px] px-2.5 py-1.5 text-[11px] ${
                      m.role === "user"
                        ? "bg-[#5d4a39] text-[#fffaf2]"
                        : "border border-[#e8dcc8] bg-white text-[#5a4938]"
                    }`}
                  >
                    <MarkdownContent
                      className={m.role === "user" ? "prose-invert" : ""}
                      content={m.content}
                    />
                  </div>
                ))
              )}
            </div>
          </details>

          {/* ROI */}
          <div className="shrink-0 grid grid-cols-2 gap-1.5">
            <button
              className="btn btn-warning !py-1.5 !text-[11px]"
              disabled={disabled || loading || !roiReady}
              onClick={onExplainRoi}
              type="button"
            >
              {loading ? "处理中…" : "解释框选区域"}
            </button>
            <p className="rounded-[14px] border border-dashed border-[#d8bf94] bg-[#fbf1df] px-2 py-1.5 text-[10px] text-[#8b6b45]">
              {roiReady ? "ROI 已选，点击解释。" : "先在左侧框选区域。"}
            </p>
          </div>

          {/* Input */}
          <div className="shrink-0 space-y-1.5">
            <textarea
              className="h-16 w-full rounded-[16px] border border-[#d5c2a4] bg-white p-2.5 text-xs text-[#554535] outline-none focus:border-[#8a9d76]"
              disabled={disabled || loading}
              onChange={(e) => onChatInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSendChat();
              }}
              placeholder="输入追问，Ctrl/⌘+Enter 发送"
              value={chatInput}
            />
            <button
              className="btn btn-dark w-full !py-1.5 !text-[11px]"
              disabled={disabled || loading || !chatInput.trim()}
              onClick={onSendChat}
              type="button"
            >
              {loading ? "发送中…" : "发送追问"}
            </button>
          </div>
        </div>
      )}

      {/* ── 笔记 ─────────────────────────────────────── */}
      {tab === "notes" && (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="shrink-0 grid grid-cols-2 gap-1 md:grid-cols-3">
            <button className="btn btn-dark !py-1.5 !text-[11px]" disabled={disabled || loading} onClick={onAutoGenerateNotes} type="button">自动生成笔记</button>
            <button className="btn btn-success !py-1.5 !text-[11px]" disabled={disabled || loading} onClick={onAppendSelectionToNotes} type="button">添加选中解释</button>
            <button className="btn btn-violet !py-1.5 !text-[11px]" disabled={disabled || loading} onClick={onFormatNotes} type="button">格式化</button>
            <button className="btn btn-soft !py-1.5 !text-[11px]" disabled={disabled || loading} onClick={onExportNotes} type="button">导出会话笔记</button>
            <button className="btn btn-blue col-span-2 !py-1.5 !text-[11px] md:col-span-1" disabled={disabled || loading} onClick={onExportAllExplanations} type="button">导出全部解析</button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-1.5 lg:grid-cols-2">
            <textarea
              className="h-full min-h-[160px] rounded-[20px] border border-[#deccb1] bg-[#fffdf8] p-2.5 font-mono text-[11px] leading-5 text-[#5a4938] shadow-inner"
              onChange={(e) => onNotesChange(e.target.value)}
              value={notesMarkdown}
            />
            <div className="min-h-0 overflow-auto rounded-[20px] border border-[#deccb1] bg-[#fffdf8] p-3">
              {notesMarkdown.trim() ? (
                <MarkdownContent content={notesMarkdown} />
              ) : (
                <p className="text-xs text-[#907d69]">笔记预览区</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 测验 ─────────────────────────────────────── */}
      {tab === "quiz" && (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="shrink-0 grid grid-cols-2 gap-1.5">
            <button className="btn btn-indigo !py-1.5 !text-[11px]" disabled={disabled || loading} onClick={onGenerateQuiz} type="button">
              {loading ? "生成中…" : "生成本页测验"}
            </button>
            <button className="btn btn-dark !py-1.5 !text-[11px]" disabled={disabled || loading || quizQuestions.length === 0} onClick={onSubmitQuiz} type="button">
              {loading ? "批改中…" : "提交批改"}
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-[22px] border border-[#e0d0bb] bg-[#fffdf8] p-3">
            {quizQuestions.length === 0 ? (
              <p className="text-xs text-[#8c7866]">先生成测验，再选择答案提交。</p>
            ) : (
              quizQuestions.map((q) => (
                <article className="rounded-[18px] border border-[#e0d0bb] bg-white p-2.5 shadow-sm" key={q.id}>
                  <p className="mb-1.5 text-xs font-medium text-[#4f4031]">{q.prompt}</p>
                  <div className="grid gap-1">
                    {q.options.map((option) => {
                      const optionKey = option.split(".")[0] ?? option;
                      const selected = quizAnswers[q.id] === optionKey;
                      return (
                        <button
                          className={`btn !justify-start !rounded-lg !px-2 !py-1 text-left !text-[11px] ${selected ? "btn-quality-done" : "btn-soft"}`}
                          key={option}
                          onClick={() => onQuizAnswerChange(q.id, optionKey)}
                          type="button"
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="shrink-0 overflow-auto rounded-[18px] bg-[#edf1f4] px-3 py-2 text-[11px] text-[#5f7488]">
            <MarkdownContent content={quizFeedback || "批改结果将显示在这里。"} />
          </div>
        </div>
      )}

      {/* ── 复习 ─────────────────────────────────────── */}
      {tab === "review" && (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <button
            className="shrink-0 btn btn-success !py-1.5 !text-[11px]"
            disabled={disabled || loading}
            onClick={onRefreshReview}
            type="button"
          >
            {loading ? "刷新中…" : "刷新复习队列"}
          </button>

          <div className="shrink-0 grid grid-cols-2 gap-1.5 md:grid-cols-4">
            <div className="rounded-[16px] bg-[#edf2e4] p-2 text-[#607253]">
              <div className="text-[9px] uppercase tracking-wider">提问</div>
              <div className="text-base font-semibold">{analytics?.user_messages ?? 0}</div>
            </div>
            <div className="rounded-[16px] bg-[#f4efe4] p-2 text-[#8b7758]">
              <div className="text-[9px] uppercase tracking-wider">回答</div>
              <div className="text-base font-semibold">{analytics?.assistant_messages ?? 0}</div>
            </div>
            <div className="rounded-[16px] bg-[#f0e7df] p-2 text-[#8d6a58]">
              <div className="text-[9px] uppercase tracking-wider">测验</div>
              <div className="text-base font-semibold">{analytics?.quiz_attempts ?? 0}</div>
            </div>
            <div className="rounded-[16px] bg-[#f7ecd8] p-2 text-[#8b6c46]">
              <div className="text-[9px] uppercase tracking-wider">掌握度</div>
              <div className="text-base font-semibold">{analytics?.avg_quiz_score_percent ?? 0}%</div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-auto rounded-[22px] border border-[#e0d0bb] bg-[#fffdf8] p-3">
            {reviewItems.length === 0 ? (
              <p className="text-xs text-[#8c7866]">暂无待复习项。测验后错题会自动加入。</p>
            ) : (
              reviewItems.map((item) => (
                <article className="rounded-[18px] border border-[#e0d0bb] bg-white p-2.5 shadow-sm" key={item.id}>
                  <p className="text-xs font-medium text-[#4f4031]">{item.prompt}</p>
                  <p className="mt-0.5 text-[10px] text-[#8c7866]">
                    间隔 {item.interval_days.toFixed(1)} 天 · 熟练度 {item.easiness.toFixed(2)} · 到期 {item.due_at.slice(0, 10)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {QUALITY_LABELS.map(({ quality, label, className }) => (
                      <button
                        className={`${className} !rounded-lg !px-2 !py-1 !text-[10px]`}
                        key={quality}
                        onClick={() => onCompleteReview(item.id, quality)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
