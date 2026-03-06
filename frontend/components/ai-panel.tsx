"use client";

import { useState } from "react";

import { MarkdownContent } from "@/components/markdown-content";
import type { ChatMessage } from "@/hooks/useChat";
import type { QuizQuestion, ReviewItem, SessionAnalyticsPayload } from "@/lib/api";

type AIPanelProps = {
  disabled: boolean;
  explanation: string;
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
  { quality: 0, label: "完全不会", className: "btn btn-outline !border-red-200 !bg-red-50 !text-red-700" },
  { quality: 2, label: "模糊记得", className: "btn btn-outline !border-orange-200 !bg-orange-50 !text-orange-700" },
  { quality: 4, label: "基本掌握", className: "btn btn-outline !border-emerald-200 !bg-emerald-50 !text-emerald-700" },
  { quality: 5, label: "完全掌握", className: "btn btn-outline !border-blue-200 !bg-blue-50 !text-blue-700" },
];

export function AIPanel({
  disabled,
  explanation,
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

  return (
    <section className="flex h-full flex-col rounded-none bg-white/85 p-4 shadow-panel lg:rounded-r-2xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm">
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

        <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-xs">
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
        <div className="flex h-full flex-col gap-3">
          <button
            className="btn btn-primary w-full !py-2.5 text-sm"
            disabled={disabled || loading}
            onClick={onGenerateExplanation}
            type="button"
          >
            {loading ? "加载中..." : "显示当前页缓存讲解"}
          </button>
          <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            {explanation ? (
              <MarkdownContent content={explanation} />
            ) : (
              <p className="text-sm text-slate-400">当前页暂无讲解缓存。</p>
            )}
          </div>
        </div>
      )}

      {tab === "chat" && (
        <div className="flex h-full flex-col gap-3">
          <div className="flex-1 space-y-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            {chatMessages.length === 0 && <p className="text-sm text-slate-500">在这里追问当前页内容。</p>}
            {chatMessages.map((message) => (
              <article
                className={`rounded-lg p-2 text-sm ${
                  message.role === "user" ? "bg-slate-900 text-white" : "bg-white text-slate-700"
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
            <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {roiReady ? "ROI 已选择，可直接解释。" : "先在左侧框选区域，再点击解释。"}
            </p>
          </div>

          <div className="space-y-2">
            <textarea
              className="h-24 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm outline-none focus:border-accent"
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
              className="btn btn-outline !py-2"
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
              className="h-full min-h-[220px] rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs leading-5 text-slate-700"
              onChange={(event) => onNotesChange(event.target.value)}
              value={notesMarkdown}
            />
            <div className="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
              {notesMarkdown.trim() ? (
                <MarkdownContent content={notesMarkdown} />
              ) : (
                <p className="text-sm text-slate-400">笔记预览区</p>
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

          <div className="flex-1 space-y-3 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            {quizQuestions.length === 0 ? (
              <p className="text-sm text-slate-500">先生成小测，再选择答案提交。</p>
            ) : (
              quizQuestions.map((question) => (
                <article className="rounded-lg border border-slate-200 bg-white p-3" key={question.id}>
                  <p className="mb-2 text-sm font-medium text-slate-700">{question.prompt}</p>
                  <div className="grid gap-1">
                    {question.options.map((option) => {
                      const optionKey = option.split(".")[0] ?? option;
                      const selected = quizAnswers[question.id] === optionKey;
                      return (
                        <button
                          className={`btn !justify-start !rounded-lg !px-2.5 !py-1.5 text-left text-xs ${
                            selected
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                              : "btn-outline"
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

          <div className="overflow-auto rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
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
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
              <div>提问次数</div>
              <div className="text-lg font-semibold">{analytics?.user_messages ?? 0}</div>
            </div>
            <div className="rounded-lg bg-cyan-50 p-2 text-cyan-700">
              <div>回答次数</div>
              <div className="text-lg font-semibold">{analytics?.assistant_messages ?? 0}</div>
            </div>
            <div className="rounded-lg bg-violet-50 p-2 text-violet-700">
              <div>测验次数</div>
              <div className="text-lg font-semibold">{analytics?.quiz_attempts ?? 0}</div>
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
              <div>平均掌握度</div>
              <div className="text-lg font-semibold">{analytics?.avg_quiz_score_percent ?? 0}%</div>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            {reviewItems.length === 0 ? (
              <p className="text-sm text-slate-500">暂无待复习项。做题后错题会自动进入这里。</p>
            ) : (
              reviewItems.map((item) => (
                <article className="rounded-lg border border-slate-200 bg-white p-3" key={item.id}>
                  <p className="text-sm font-medium text-slate-700">{item.prompt}</p>
                  <p className="mt-1 text-xs text-slate-500">
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
