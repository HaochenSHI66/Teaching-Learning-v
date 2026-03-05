"use client";

import { useState } from "react";

import type { QuizQuestion, ReviewItem, SessionAnalyticsPayload } from "@/lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

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
  onGenerateQuiz: () => void;
  onQuizAnswerChange: (questionId: string, answer: string) => void;
  onSubmitQuiz: () => void;
  onRefreshReview: () => void;
  onCompleteReview: (reviewId: string) => void;
};

const TABS = [
  { key: "explain", label: "讲解" },
  { key: "chat", label: "问答" },
  { key: "notes", label: "笔记" },
  { key: "quiz", label: "练习" },
  { key: "review", label: "复习" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

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
  onGenerateQuiz,
  onQuizAnswerChange,
  onSubmitQuiz,
  onRefreshReview,
  onCompleteReview,
}: AIPanelProps) {
  const [tab, setTab] = useState<TabKey>("explain");

  return (
    <section className="flex h-full flex-col rounded-2xl bg-white/85 p-4 shadow-panel">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`rounded-full px-3 py-1 transition ${
                tab === item.key ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-100"
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
            className={`rounded-full px-3 py-1 ${mode === "slide" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            onClick={() => onModeChange("slide")}
            type="button"
          >
            跟随当前页
          </button>
          <button
            className={`rounded-full px-3 py-1 ${mode === "global" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            onClick={() => onModeChange("global")}
            type="button"
          >
            全局
          </button>
        </div>
      </header>

      {tab === "explain" && (
        <div className="flex h-full flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <button
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={disabled || loading}
              onClick={onGenerateExplanation}
              type="button"
            >
              {loading ? "生成中..." : "生成当前页讲解"}
            </button>
            <button
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={disabled || loading || !roiReady}
              onClick={onExplainRoi}
              type="button"
            >
              {loading ? "分析中..." : "解释框选区域"}
            </button>
          </div>
          {!roiReady ? (
            <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              在左侧图片上拖拽框选后可启用区域解释。
            </p>
          ) : null}
          <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {explanation || "点击按钮生成结构化讲解。"}
          </pre>
        </div>
      )}

      {tab === "chat" && (
        <div className="flex h-full flex-col gap-3">
          <div className="flex-1 space-y-2 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            {chatMessages.length === 0 && <p className="text-sm text-slate-500">在这里追问当前页内容。</p>}
            {chatMessages.map((message, idx) => (
              <article
                className={`rounded-lg p-2 text-sm ${
                  message.role === "user" ? "bg-slate-900 text-white" : "bg-white text-slate-700"
                }`}
                key={`${message.role}-${idx}`}
              >
                {message.content}
              </article>
            ))}
          </div>

          <div className="space-y-2">
            <textarea
              className="h-24 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm outline-none focus:border-accent"
              disabled={disabled || loading}
              onChange={(event) => onChatInputChange(event.target.value)}
              placeholder="输入追问，例如：这个公式为什么成立？"
              value={chatInput}
            />
            <button
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-300"
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
          <button
            className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={disabled || loading}
            onClick={onExportNotes}
            type="button"
          >
            导出 Markdown 笔记
          </button>
          <textarea
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700"
            readOnly
            value={notesMarkdown || "导出后会显示 Markdown 内容。"}
          />
        </div>
      )}

      {tab === "quiz" && (
        <div className="flex h-full flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <button
              className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={disabled || loading}
              onClick={onGenerateQuiz}
              type="button"
            >
              {loading ? "生成中..." : "生成本页小测"}
            </button>
            <button
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
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
                          className={`rounded-md border px-2 py-1 text-left text-xs ${
                            selected
                              ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
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

          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            {quizFeedback || "批改结果将显示在这里。"}
          </p>
        </div>
      )}

      {tab === "review" && (
        <div className="flex h-full flex-col gap-3">
          <button
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
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
                  <p className="mt-1 text-xs text-slate-500">slide: {item.slide_id} | 到期: {item.due_at}</p>
                  <button
                    className="mt-2 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                    onClick={() => onCompleteReview(item.id)}
                    type="button"
                  >
                    标记已复习
                  </button>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
