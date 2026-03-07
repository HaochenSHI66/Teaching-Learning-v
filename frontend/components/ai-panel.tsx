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
};

const TABS = [
  { key: "explain", label: "讲解" },
  { key: "chat", label: "问答" },
  { key: "notes", label: "笔记" },
  { key: "quiz", label: "练习" },
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
    return (
      "> [!NOTE]\n" +
      "> 当前页尚未提取出结构化内容。"
    );
  }

  const lines = [
    "> [!NOTE]",
    "> 以下内容来自当前页的非大模型提取结果，可用于定位结构、图块和阅读顺序。",
    "",
    `**Summary**：${extraction.summary || "本页以图像或版面结构为主，暂无稳定文本摘要。"}`,
    "",
    "### Detected Structure",
    `- Text Blocks: **${extraction.page_stats.text_block_count ?? 0}**`,
    `- Figures: **${extraction.page_stats.figure_count ?? 0}**`,
    `- Tables: **${extraction.page_stats.table_count ?? 0}**`,
  ];

  if (extraction.title_candidates.length > 0) {
    lines.push("", "### Title Candidates", ...extraction.title_candidates.slice(0, 3).map((item) => `- ${item}`));
  }

  if (extraction.text_blocks.length > 0) {
    lines.push("", "### Text Blocks");
    for (const block of extraction.text_blocks.slice(0, 5)) {
      lines.push(`- **${block.type}**: ${block.text ?? ""}`);
    }
  }

  if (extraction.figures.length > 0) {
    lines.push("", "### Figure Regions");
    for (const figure of extraction.figures) {
      lines.push(`- **${figure.label ?? figure.id}**`);
    }
  }

  return lines.join("\n");
}

function getExplanationBadge(
  explanationState: AIPanelProps["explanationState"],
  explanationLoading: boolean,
) {
  if (explanationLoading) {
    return { label: "生成中", className: "bg-[#f7ecd6] text-[#8c6c46] border-[#d8bf94]" };
  }

  switch (explanationState) {
    case "ready":
      return { label: "已缓存", className: "bg-[#e8efe0] text-[#607253] border-[#c8d5b9]" };
    case "error":
      return { label: "失败", className: "bg-[#f5e3dc] text-[#9a5e4e] border-[#e0b5a7]" };
    case "generating":
      return { label: "生成中", className: "bg-[#f7ecd6] text-[#8c6c46] border-[#d8bf94]" };
    default:
      return { label: "未生成", className: "bg-[#efe7dc] text-[#826f5c] border-[#ddcfbc]" };
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
}: AIPanelProps) {
  const [tab, setTab] = useState<TabKey>("explain");
  const badge = getExplanationBadge(explanationState, explanationLoading);
  const extractionMarkdown = buildExtractionMarkdown(extraction);

  return (
    <section className="flex h-full flex-col rounded-[30px] border border-[#d9c7ab] bg-[linear-gradient(180deg,#fffaf2,#f6ebdb)] p-4 shadow-[0_28px_60px_rgba(122,98,66,0.12)]">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-[#e0d0bb] bg-[#fffdf8] p-1 text-sm shadow-sm">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`btn btn-segment ${
                tab === item.key ? "btn-segment-active" : "btn-segment-idle"
              }`}
              onClick={() => setTab(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-full border border-[#e0d0bb] bg-[#fffdf8] p-1 text-xs shadow-sm">
          <button
            className={`btn btn-segment ${mode === "slide" ? "btn-segment-active" : "btn-segment-idle"}`}
            onClick={() => onModeChange("slide")}
            type="button"
          >
            跟随当前页
          </button>
          <button
            className={`btn btn-segment ${mode === "global" ? "btn-segment-active" : "btn-segment-idle"}`}
            onClick={() => onModeChange("global")}
            type="button"
          >
            全局
          </button>
        </div>
      </header>

      {tab === "explain" && (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <section className="max-h-[280px] shrink-0 overflow-auto rounded-[24px] border border-[#ddcfbc] bg-[#fffdf8] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-[#a18a72]">Current Page Extraction</p>
                <p className="mt-1 text-sm font-medium text-[#4b3d2f]">当前页提取</p>
              </div>
              <span className="rounded-full border border-[#ddcfbc] bg-[#f4ecdf] px-3 py-1 text-[11px] text-[#7e6a57]">
                Non-LLM
              </span>
            </div>
            <MarkdownContent content={extractionMarkdown} />
            {extraction?.figures?.length ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {extraction.figures.map((figure) => (
                  <article
                    className="rounded-[18px] border border-[#e3d6c3] bg-white p-3 shadow-sm"
                    key={figure.id}
                  >
                    {figure.preview_image_url ? (
                      <img
                        alt={figure.label ?? figure.id}
                        className="mb-2 h-28 w-full rounded-[14px] object-cover"
                        src={figure.preview_image_url}
                      />
                    ) : null}
                    <p className="text-xs font-medium text-[#4f4031]">{figure.label ?? figure.id}</p>
                    <p className="mt-1 text-[11px] text-[#8a7764]">
                      bbox: {figure.bbox.map((value) => value.toFixed(0)).join(", ")}
                    </p>
                  </article>
                ))}
              </div>
            ) : null}
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-[#e0d0bb] bg-[#fffdf8]">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eee2cf] px-4 py-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-[#a18a72]">LLM Explanation</p>
                <p className="mt-1 text-sm font-medium text-[#4b3d2f]">当前页讲解</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-[11px] ${badge.className}`}>{badge.label}</span>
                <button
                  className="btn btn-primary !py-2.5 text-sm"
                  disabled={disabled || loading}
                  onClick={onGenerateExplanation}
                  type="button"
                >
                  {explanationLoading ? "生成中..." : "生成本页讲解"}
                </button>
              </div>
            </header>

            {explanationLoading && (
              <div className="border-b border-[#eee2cf] px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-[#9a7e63]">
                  <span>正在调用 AI 生成讲解，请稍候…</span>
                  <span className="animate-pulse">●</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ede3d3]">
                  <div className="h-full w-1/2 animate-[slide_1.6s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[#c9a97a] via-[#e8c98a] to-[#c9a97a]" />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto p-4" data-note-source="explanation-content">
              {explanation ? (
                <MarkdownContent content={explanation} />
              ) : (
                <MarkdownContent
                  content={
                    "> [!NOTE]\n" +
                    "> 当前页讲解等待大模型生成。\n" +
                    "> 你可以先参考上方的提取结果，再点击“生成本页讲解”。"
                  }
                />
              )}
            </div>
          </section>
        </div>
      )}

      {tab === "chat" && (
        <div className="flex h-full flex-col gap-3">
          <div className="flex-1 space-y-2 overflow-auto rounded-[24px] border border-[#e0d0bb] bg-[#fffdf8] p-4">
            {chatMessages.length === 0 && <p className="text-sm text-[#8c7866]">在这里追问当前页内容。</p>}
            {chatMessages.map((message) => (
              <article
                className={`rounded-[18px] p-3 text-sm shadow-sm ${
                  message.role === "user" ? "bg-[#5d4a39] text-[#fffaf2]" : "border border-[#e8dcc8] bg-white text-[#5a4938]"
                }`}
                key={message.id}
              >
                <MarkdownContent
                  className={message.role === "user" ? "prose-invert" : ""}
                  content={message.content}
                />
              </article>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <button
              className="btn btn-warning !py-2.5 text-sm"
              disabled={disabled || loading || !roiReady}
              onClick={onExplainRoi}
              type="button"
            >
              {loading ? "处理中..." : "解释框选区域"}
            </button>
            <p className="rounded-[18px] border border-dashed border-[#d8bf94] bg-[#fbf1df] px-3 py-2 text-xs text-[#8b6b45]">
              {roiReady ? "ROI 已选择，可直接解释。" : "先在左侧框选区域，再点击解释。"}
            </p>
          </div>

          <div className="space-y-2">
            <textarea
              className="h-24 w-full rounded-[18px] border border-[#d5c2a4] bg-white p-3 text-sm text-[#554535] outline-none focus:border-[#8a9d76]"
              disabled={disabled || loading}
              onChange={(event) => onChatInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  onSendChat();
                }
              }}
              placeholder="输入追问，Ctrl/⌘+Enter 发送"
              value={chatInput}
            />
            <button
              className="btn btn-dark w-full !py-2.5 text-sm"
              disabled={disabled || loading || !chatInput.trim()}
              onClick={onSendChat}
              type="button"
            >
              {loading ? "发送中..." : "发送问题"}
            </button>
          </div>
        </div>
      )}

      {tab === "notes" && (
        <div className="flex h-full flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
            <button
              className="btn btn-dark !py-2"
              disabled={disabled || loading}
              onClick={onAutoGenerateNotes}
              type="button"
            >
              自动生成笔记
            </button>
            <button
              className="btn btn-success !py-2"
              disabled={disabled || loading}
              onClick={onAppendSelectionToNotes}
              type="button"
            >
              添加选中解释
            </button>
            <button
              className="btn btn-violet !py-2"
              disabled={disabled || loading}
              onClick={onFormatNotes}
              type="button"
            >
              格式化笔记
            </button>
            <button
              className="btn btn-soft !py-2"
              disabled={disabled || loading}
              onClick={onExportNotes}
              type="button"
            >
              导出会话笔记
            </button>
            <button
              className="btn btn-blue col-span-2 !py-2 md:col-span-1"
              disabled={disabled || loading}
              onClick={onExportAllExplanations}
              type="button"
            >
              导出全部讲解MD
            </button>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
            <textarea
              className="h-full min-h-[220px] rounded-[24px] border border-[#deccb1] bg-[#fffdf8] p-3 font-mono text-xs leading-5 text-[#5a4938] shadow-inner"
              onChange={(event) => onNotesChange(event.target.value)}
              value={notesMarkdown}
            />
            <div className="overflow-auto rounded-[24px] border border-[#deccb1] bg-[#fffdf8] p-4">
              {notesMarkdown.trim() ? (
                <MarkdownContent content={notesMarkdown} />
              ) : (
                <p className="text-sm text-[#907d69]">笔记预览区</p>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "quiz" && (
        <div className="flex h-full flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <button
              className="btn btn-indigo !py-2.5 text-sm"
              disabled={disabled || loading}
              onClick={onGenerateQuiz}
              type="button"
            >
              {loading ? "生成中..." : "生成本页小测"}
            </button>
            <button
              className="btn btn-dark !py-2.5 text-sm"
              disabled={disabled || loading || quizQuestions.length === 0}
              onClick={onSubmitQuiz}
              type="button"
            >
              {loading ? "批改中..." : "提交并批改"}
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-auto rounded-[24px] border border-[#e0d0bb] bg-[#fffdf8] p-4">
            {quizQuestions.length === 0 ? (
              <p className="text-sm text-[#8c7866]">先生成小测，再选择答案提交。</p>
            ) : (
              quizQuestions.map((question) => (
                <article className="rounded-[20px] border border-[#e0d0bb] bg-white p-3 shadow-sm" key={question.id}>
                  <p className="mb-2 text-sm font-medium text-[#4f4031]">{question.prompt}</p>
                  <div className="grid gap-1">
                    {question.options.map((option) => {
                      const optionKey = option.split(".")[0] ?? option;
                      const selected = quizAnswers[question.id] === optionKey;
                      return (
                        <button
                          className={`btn !justify-start !rounded-lg !px-2.5 !py-1.5 text-left text-xs ${
                            selected ? "btn-quality-done" : "btn-soft"
                          }`}
                          key={option}
                          onClick={() => onQuizAnswerChange(question.id, optionKey)}
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

          <div className="overflow-auto rounded-[20px] bg-[#edf1f4] px-3 py-3 text-xs text-[#5f7488]">
            <MarkdownContent content={quizFeedback || "批改结果将显示在这里。"} />
          </div>
        </div>
      )}

      {tab === "review" && (
        <div className="flex h-full flex-col gap-3">
          <button
            className="btn btn-success !py-2.5 text-sm"
            disabled={disabled || loading}
            onClick={onRefreshReview}
            type="button"
          >
            {loading ? "刷新中..." : "刷新复习队列与分析"}
          </button>

          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <div className="rounded-[20px] bg-[#edf2e4] p-3 text-[#607253]">
              <div>提问次数</div>
              <div className="text-lg font-semibold">{analytics?.user_messages ?? 0}</div>
            </div>
            <div className="rounded-[20px] bg-[#f4efe4] p-3 text-[#8b7758]">
              <div>回答次数</div>
              <div className="text-lg font-semibold">{analytics?.assistant_messages ?? 0}</div>
            </div>
            <div className="rounded-[20px] bg-[#f0e7df] p-3 text-[#8d6a58]">
              <div>测验次数</div>
              <div className="text-lg font-semibold">{analytics?.quiz_attempts ?? 0}</div>
            </div>
            <div className="rounded-[20px] bg-[#f7ecd8] p-3 text-[#8b6c46]">
              <div>平均掌握度</div>
              <div className="text-lg font-semibold">{analytics?.avg_quiz_score_percent ?? 0}%</div>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-auto rounded-[24px] border border-[#e0d0bb] bg-[#fffdf8] p-4">
            {reviewItems.length === 0 ? (
              <p className="text-sm text-[#8c7866]">暂无待复习项。做题后错题会自动进入这里。</p>
            ) : (
              reviewItems.map((item) => (
                <article className="rounded-[20px] border border-[#e0d0bb] bg-white p-3 shadow-sm" key={item.id}>
                  <p className="text-sm font-medium text-[#4f4031]">{item.prompt}</p>
                  <p className="mt-1 text-xs text-[#8c7866]">
                    复习间隔：{item.interval_days.toFixed(1)} 天 | 熟练度：{item.easiness.toFixed(2)} | 到期：{item.due_at.slice(0, 10)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {QUALITY_LABELS.map(({ quality, label, className }) => (
                      <button
                        className={`${className} !rounded-lg !px-2.5 !py-1.5 text-xs`}
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
