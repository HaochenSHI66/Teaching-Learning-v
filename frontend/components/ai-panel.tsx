"use client";

import { useMemo, useRef, useState } from "react";

import { ConceptHighlightedContent } from "@/components/concept-highlighted-content";
import { KnowledgeGraphPanel } from "@/components/knowledge-graph";
import { MarkdownContent } from "@/components/markdown-content";
import { SelectionPopup } from "@/components/selection-popup";
import type { ChatMessage } from "@/hooks/useChat";
import { getAssetUrl, type SlideExplanation, type SlideExtract } from "@/lib/api";

type AIPanelProps = {
  disabled: boolean;
  explanation: string;
  explanationMeta: SlideExplanation["meta"] | null;
  explanationLoading: boolean;
  explanationState: "not_generated" | "ready" | "generating" | "error";
  extraction: SlideExtract | null;
  loading: boolean;
  chatInput: string;
  chatMessages: ChatMessage[];
  currentSlideId?: string;
  documentId?: string;
  mode: "slide" | "global";
  roiReady: boolean;
  onModeChange: (mode: "slide" | "global") => void;
  onChatInputChange: (value: string) => void;
  onSendChat: () => void;
  onGenerateExplanation: () => void;
  onBatchGenerate?: () => void;
  onExplainRoi: () => void;
  onClearSlideMessages: () => void;
  onInsertToNotes: (text: string) => void;
  onElaborateSelection: (text: string) => void;
  onJumpToSlide?: (slideId: string) => void;
};

const TABS = [
  { key: "explain", label: "解析" },
  { key: "summary", label: "总结" },
  { key: "extract", label: "结构" },
  { key: "chat", label: "追问" },
  { key: "graph", label: "图谱" },
] as const;

type TabKey = (typeof TABS)[number]["key"];


function buildExtractionMarkdown(extraction: SlideExtract | null) {
  if (!extraction) {
    return "**当前页尚未提取出结构化内容。**";
  }

  const stats = extraction.page_stats;
  // Derive counts from available data when page_stats is empty (legacy documents)
  const wordCount = stats.word_count ?? (extraction.text ? extraction.text.split(/\s+/).filter(Boolean).length : 0);
  const textBlockCount = stats.text_block_count ?? extraction.text_blocks.length;
  const bulletCount = stats.bullet_count ?? extraction.bullet_blocks.length;
  const figureCount = stats.figure_count ?? extraction.figures.length;

  const lines = [
    "_非大模型提取，用于定位页面结构与阅读顺序。_",
    "",
    "### 页面统计",
    `- 文字量（词）：**${wordCount}**`,
    `- 文本块：**${textBlockCount}**（含要点 **${bulletCount}**）`,
    `- 图示区域：**${figureCount}**`,
  ];

  if (extraction.title_candidates.length > 0) {
    lines.push("", "### 标题候选", ...extraction.title_candidates.slice(0, 3).map((t) => `- ${t}`));
  }

  // Prefer structured blocks; fall back to raw text when blocks are absent (legacy)
  const allTextBlocks = [...extraction.text_blocks, ...extraction.bullet_blocks];
  if (allTextBlocks.length > 0) {
    lines.push("", "### 页面文本");
    for (const b of allTextBlocks) {
      const prefix = b.type === "bullet" ? "- " : "";
      const snippet = (b.text ?? "").trim();
      if (snippet) lines.push(`${prefix}${snippet}`);
    }
  } else if (extraction.text.trim()) {
    lines.push("", "### 页面文本");
    lines.push(extraction.text.trim());
  }

  if (extraction.equation_like_blocks.length > 0) {
    lines.push("", "### 公式/数学区域");
    for (const b of extraction.equation_like_blocks) {
      const snippet = (b.text ?? "").trim();
      if (snippet) lines.push(`- ${snippet}`);
    }
  }

  if (extraction.code_like_blocks.length > 0) {
    lines.push("", "### 代码区域");
    for (const b of extraction.code_like_blocks) {
      const snippet = (b.text ?? "").trim();
      if (snippet) lines.push("```\n" + snippet + "\n```");
    }
  }

  if (extraction.figures.length > 0) {
    lines.push("", "### 图示区域");
    for (const f of extraction.figures) {
      const label = f.label && !f.label.startsWith("Figure Region") ? f.label : null;
      lines.push(`- ${label ?? `图 ${f.order + 1}`}`);
    }
  }

  if (extraction.repeat_analysis) {
    const repeat = extraction.repeat_analysis;
    const repeatedPercent = Math.round((repeat.repeated_ratio ?? 0) * 100);
    lines.push("", "### 重复分析");
    lines.push(`- 状态：**${repeat.status || "unknown"}**`);
    lines.push(`- 最近比较页：${repeat.window_pages?.length ? repeat.window_pages.join(", ") : "无"}`);
    lines.push(`- 重复页：${repeat.repeat_pages?.length ? repeat.repeat_pages.join(", ") : "无"}`);
    lines.push(`- 重复占比：**${repeatedPercent}%**`);
    lines.push(`- 新增块：**${repeat.new_block_ids?.length ?? 0}**`);
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
    default:           return { label: "待生成", cls: "bg-[#efe7dc] text-[#826f5c] border-[#ddcfbc]" };
  }
}

export function AIPanel({
  disabled,
  explanation,
  explanationMeta,
  explanationLoading,
  explanationState,
  extraction,
  loading,
  chatInput,
  chatMessages,
  currentSlideId,
  documentId,
  mode,
  roiReady,
  onModeChange,
  onChatInputChange,
  onSendChat,
  onGenerateExplanation,
  onBatchGenerate,
  onExplainRoi,
  onClearSlideMessages,
  onInsertToNotes,
  onElaborateSelection,
  onJumpToSlide,
}: AIPanelProps) {
  const [tab, setTab] = useState<TabKey>("explain");
  const explanationRef = useRef<HTMLDivElement>(null);
  const badge = getExplanationBadge(explanationState, explanationLoading);
  const extractionMarkdown = useMemo(() => buildExtractionMarkdown(extraction), [extraction]);
  const repeatSummary = explanationMeta?.repeat_summary;
  const hasStructuredExplanation = Boolean(
    explanationMeta?.sections?.translation_md && explanationMeta?.sections?.primary_md,
  );

  const slideMessages = useMemo(
    () => (currentSlideId ? chatMessages.filter((m) => m.slideId === currentSlideId) : chatMessages),
    [currentSlideId, chatMessages],
  );

  // Task 4: Compute which tabs have content for badge indicators
  const tabHasContent: Record<TabKey, boolean> = {
    explain: explanationState === "ready",
    summary: Boolean(explanationMeta?.sections?.summary_md),
    extract: Boolean(extraction),
    chat: slideMessages.length > 0,
    graph: false, // Graph state is internal to KnowledgeGraphPanel; no external signal available
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[30px] border border-[#d9c7ab] bg-[linear-gradient(180deg,#fffaf2,#f6ebdb)] p-3 shadow-[0_28px_60px_rgba(122,98,66,0.12)]">
      {/* Tab bar */}
      <header className="mb-2 shrink-0">
        <div className="inline-flex flex-wrap gap-0.5 rounded-full border border-[#e0d0bb] bg-[#fffdf8] p-0.5 shadow-sm">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`btn btn-segment !px-3 !py-1.5 !text-[13px] relative ${tab === item.key ? "btn-segment-active" : "btn-segment-idle"}`}
              onClick={() => setTab(item.key)}
              type="button"
            >
              {item.label}
              {tabHasContent[item.key] && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#8a9d76]"
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
      </header>

      {/* ── 解析 ─────────────────────────────────────── */}
      {tab === "explain" && (
        <div key="explain" className="animate-fade-slide-in flex min-h-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-[#e0d0bb] bg-[#fffdf8]">
            <header className="shrink-0 flex items-center justify-between gap-2 border-b border-[#eee2cf] px-3 py-2">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-medium text-[#4b3d2f]">当前页解析</p>
                {repeatSummary?.has_repeat_section ? (
                  <span className="rounded-full border border-[#d8bf94] bg-[#f8efdc] px-2 py-0.5 text-[12px] text-[#8a6a46]">
                    重复 {Math.round((repeatSummary.repeated_ratio ?? 0) * 100)}% · 来自第 {repeatSummary.repeat_pages.join(", ")} 页
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`rounded-full border px-2 py-0.5 text-[12px] ${badge.cls}`}>{badge.label}</span>
                <button
                  className="btn btn-primary !px-3 !py-1.5 !text-[13px] gap-1.5"
                  disabled={disabled || loading}
                  onClick={onGenerateExplanation}
                  type="button"
                >
                  {explanationLoading && (
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  )}
                  {explanationLoading ? "生成中…" : "生成解析"}
                </button>
              </div>
            </header>

            {explanationLoading && (
              <div className="shrink-0 border-b border-[#eee2cf] px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-[12px] text-[#9a7e63]">
                  <span>解析生成中…</span>
                  <span className="animate-pulse">●</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-[#ede3d3]">
                  <div className="h-full w-1/2 animate-[slide_1.6s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[#c9a97a] via-[#e8c98a] to-[#c9a97a]" />
                </div>
              </div>
            )}

            <div ref={explanationRef} className="min-h-0 flex-1 overflow-auto p-3" data-note-source="explanation-content">
              {hasStructuredExplanation ? (
                <div className="space-y-3">
                  {explanationMeta?.title && (
                    <h2 className="text-lg font-bold text-[#2d2015] border-b border-[#e8dcc8] pb-2 mb-1">
                      {explanationMeta.title}
                    </h2>
                  )}
                  <ConceptHighlightedContent
                    content={explanationMeta?.sections.translation_md ?? ""}
                    documentId={documentId}
                    slideId={currentSlideId}
                    onJumpToSlide={onJumpToSlide}
                  />
                  <ConceptHighlightedContent
                    content={explanationMeta?.sections.primary_md ?? ""}
                    documentId={documentId}
                    slideId={currentSlideId}
                    onJumpToSlide={onJumpToSlide}
                  />
                  {explanationMeta?.sections.repeat_md ? (
                    <details className="overflow-hidden rounded-[18px] border border-[#dcccb6] bg-[#fbf6ec]">
                      <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-[#6e5942]">
                        重复部分讲解
                        <span className="ml-2 text-[12px] font-normal text-[#9a846a]">
                          来自第 {repeatSummary?.repeat_pages?.join(", ") || "前序"} 页
                        </span>
                      </summary>
                      <div className="border-t border-[#ede3d3] px-3 py-3">
                        <MarkdownContent content={explanationMeta.sections.repeat_md} />
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : explanation ? (
                <ConceptHighlightedContent
                  content={explanation}
                  documentId={documentId}
                  slideId={currentSlideId}
                  onJumpToSlide={onJumpToSlide}
                />
              ) : (
                <div className="space-y-3">
                  <MarkdownContent
                    content={
                      "**当前页解析尚未生成。** 点击「生成解析」开始。"
                    }
                  />
                  {onBatchGenerate && (
                    <button
                      className="btn btn-outline !px-3 !py-1.5 !text-[13px]"
                      disabled={disabled || loading}
                      onClick={onBatchGenerate}
                      type="button"
                    >
                      为所有页面生成解析
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
          <SelectionPopup
            containerRef={explanationRef}
            onInsert={onInsertToNotes}
            onElaborate={onElaborateSelection}
            disabled={disabled || loading}
          />
        </div>
      )}

      {/* ── 总结 ─────────────────────────────────────── */}
      {tab === "summary" && (
        <div key="summary" className="animate-fade-slide-in flex min-h-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-[#e0d0bb] bg-[#fffdf8]">
            <header className="shrink-0 flex items-center gap-2 border-b border-[#eee2cf] px-3 py-2">
              <p className="text-[13px] font-medium text-[#4b3d2f]">知识点总结</p>
              <span className="rounded-full border border-[#d8bf94] bg-[#f8efdc] px-2 py-0.5 text-[12px] text-[#8a6a46]">
                快速复习
              </span>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {explanationMeta?.sections?.summary_md ? (
                <MarkdownContent content={explanationMeta.sections.summary_md} />
              ) : explanationMeta?.title ? (
                <MarkdownContent content={`**「${explanationMeta.title}」尚未生成知识点总结。**\n\n点击「解析」标签页的「生成解析」按钮重新生成。`} />
              ) : (
                <MarkdownContent content="**当前页尚未生成知识点总结。** 点击「解析」标签页的「生成解析」按钮开始。" />
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── 结构 ─────────────────────────────────────── */}
      {tab === "extract" && (
        <div key="extract" className="animate-fade-slide-in min-h-0 flex-1 overflow-auto rounded-[22px] border border-[#ddcfbc] bg-[#fffdf8] p-3">
          <div className="mb-2 flex items-center gap-2">
            <p className="text-[13px] font-medium text-[#4b3d2f]">页面结构</p>
            <span className="rounded-full border border-[#ddcfbc] bg-[#f4ecdf] px-2 py-0.5 text-[11px] text-[#7e6a57]">Non-LLM</span>
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
                      src={getAssetUrl(figure.preview_image_url)}
                    />
                  ) : null}
                  <p className="text-[13px] font-medium text-[#4f4031]">
                    {figure.label && !figure.label.startsWith("Figure Region") ? figure.label : `图 ${figure.order + 1}`}
                  </p>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* ── 追问 ─────────────────────────────────────── */}
      {tab === "chat" && (
        <div key="chat" className="animate-fade-slide-in flex min-h-0 flex-1 flex-col gap-1.5">
          {/* Mode toggle */}
          <div className="shrink-0 flex items-center justify-between rounded-[16px] border border-[#e0d0bb] bg-[#fffdf8] px-2.5 py-1.5">
            <span className="text-[12px] text-[#9a846a]">提问范围</span>
            <div className="inline-flex rounded-full border border-[#e0d0bb] bg-[#f5ece0] p-0.5">
              <button
                className={`btn btn-segment !px-2.5 !py-1 !text-[12px] ${mode === "slide" ? "btn-segment-active" : "btn-segment-idle"}`}
                onClick={() => onModeChange("slide")}
                type="button"
              >
                当前页
              </button>
              <button
                className={`btn btn-segment !px-2.5 !py-1 !text-[12px] ${mode === "global" ? "btn-segment-active" : "btn-segment-idle"}`}
                onClick={() => onModeChange("global")}
                type="button"
              >
                全局
              </button>
            </div>
          </div>

          {/* Collapsible history */}
          <details className="shrink-0 overflow-hidden rounded-[16px] border border-[#e0d0bb] bg-[#fffdf8]" open={slideMessages.length > 0}>
            <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[12px] text-[#9a846a] hover:bg-[#f8f2e8]">
              <span>本页问答（{Math.floor(slideMessages.length / 2)} 条）</span>
              <button
                className="btn btn-outline !rounded-lg !px-2 !py-0.5 !text-[12px]"
                disabled={slideMessages.length === 0}
                onClick={(e) => { e.preventDefault(); onClearSlideMessages(); }}
                type="button"
              >
                清空
              </button>
            </summary>
            <div className="max-h-44 space-y-1.5 overflow-auto border-t border-[#eee2cf] px-3 py-2">
              {slideMessages.length === 0 ? (
                <p className="text-[13px] text-[#b09a87]">暂无问答记录。</p>
              ) : (
                slideMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-[12px] px-2.5 py-1.5 text-[13px] ${
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
              className="btn btn-warning !py-1.5 !text-[13px]"
              disabled={disabled || loading || !roiReady}
              onClick={onExplainRoi}
              type="button"
            >
              {loading ? "处理中…" : "解析框选区域"}
            </button>
            <p className="rounded-[14px] border border-dashed border-[#d8bf94] bg-[#fbf1df] px-2 py-1.5 text-[12px] text-[#8b6b45]">
              {roiReady ? "区域已选，点击解析。" : "框选左侧区域后解析。"}
            </p>
          </div>

          {/* Input */}
          <div className="shrink-0 space-y-1.5">
            <textarea
              className="h-16 w-full rounded-[16px] border border-[#d5c2a4] bg-white p-2.5 text-[13px] text-[#554535] outline-none focus:border-[#8a9d76]"
              disabled={disabled || loading}
              onChange={(e) => onChatInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSendChat();
              }}
              placeholder="输入问题，Ctrl/⌘+Enter 发送"
              value={chatInput}
            />
            <button
              className="btn btn-dark w-full !py-1.5 !text-[13px]"
              disabled={disabled || loading || !chatInput.trim()}
              onClick={onSendChat}
              type="button"
            >
              {loading ? "发送中…" : "发送"}
            </button>
          </div>
        </div>
      )}

      {/* ── 图谱 ─────────────────────────────────────── */}
      {tab === "graph" && (
        <div key="graph" className="animate-fade-slide-in min-h-0 flex-1 overflow-hidden rounded-[22px] border border-[#ddcfbc] bg-[#fffdf8] p-3">
          {documentId ? (
            <KnowledgeGraphPanel
              documentId={documentId}
              onJumpToSlide={onJumpToSlide}
              disabled={disabled || loading}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-[#9a846a]">
              请先选择文档
            </div>
          )}
        </div>
      )}

    </section>
  );
}
