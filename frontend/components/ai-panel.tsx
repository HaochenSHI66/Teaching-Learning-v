"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ConceptHighlightedContent } from "@/components/concept-highlighted-content";
import { KnowledgeGraphPanel } from "@/components/knowledge-graph";
import { MarkdownContent } from "@/components/markdown-content";
import { SelectionPopup } from "@/components/selection-popup";
import { StructuredContent } from "@/components/structured-content";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ChatMessage } from "@/hooks/useChat";
import type { BatchProgress, GenerationProgress } from "@/hooks/useSlideGeneration";
import { getAssetUrl, type SlideExplanation, type SlideExtract } from "@/lib/api";

type AIPanelProps = {
  batchProgress?: BatchProgress | null;
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
  generationProgress: GenerationProgress | null;
  onModeChange: (mode: "slide" | "global") => void;
  onChatInputChange: (value: string) => void;
  onSendChat: () => void;
  onGenerateExplanation: () => void;
  onBatchGenerate?: () => void;
  onExplainRoi: () => void;
  onClearSlideMessages: () => void;
  onElaborateSelection: (text: string) => void;
  onJumpToSlide?: (slideId: string) => void;
  /** Map slide ID → page number for display */
  slidePageMap?: Record<string, number>;
  sessionId?: string;
};

const TABS = [
  { key: "explain", label: "解析" },
  { key: "translate", label: "翻译" },
  { key: "chat", label: "追问" },
  { key: "graph", label: "概念" },
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
  if (explanationLoading) return { label: "生成中", cls: "bg-[var(--ac-amber-bg)] text-[var(--ac-amber-text)] border-[var(--ac-amber-border)]" };
  switch (explanationState) {
    case "ready":      return { label: "已缓存", cls: "bg-[var(--ac-green-bg)] text-[var(--ac-green-text)] border-[var(--ac-green-border)]" };
    case "error":      return { label: "失败",   cls: "bg-[var(--ac-red-bg)] text-[var(--ac-red-text)] border-[var(--ac-red-border)]" };
    case "generating": return { label: "生成中", cls: "bg-[var(--ac-amber-bg)] text-[var(--ac-amber-text)] border-[var(--ac-amber-border)]" };
    default:           return { label: "待生成", cls: "bg-[var(--ac-muted-bg)] text-[var(--ac-muted-text)] border-[var(--ac-muted-border)]" };
  }
}

export function AIPanel({
  batchProgress,
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
  generationProgress,
  onModeChange,
  onChatInputChange,
  onSendChat,
  onGenerateExplanation,
  onBatchGenerate,
  onExplainRoi,
  onClearSlideMessages,
  onElaborateSelection,
  onJumpToSlide,
  slidePageMap,
  sessionId,
}: AIPanelProps) {
  const [tab, setTab] = useState<TabKey>("explain");
  const explanationRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [translation, setTranslation] = useState<string>("");
  const [translationLoading, setTranslationLoading] = useState(false);
  const translationSlideRef = useRef<string | null>(null);

  // Font size control (persisted in localStorage)
  const FONT_SIZES = [14, 15, 16.5, 18, 20] as const;
  const [fontSizeIdx, setFontSizeIdx] = useState(() => {
    if (typeof window === "undefined") return 2;
    const saved = localStorage.getItem("tl-font-size-idx");
    return saved ? Math.min(Math.max(Number(saved), 0), FONT_SIZES.length - 1) : 2;
  });
  const fontSize = FONT_SIZES[fontSizeIdx];
  const changeFontSize = (delta: number) => {
    setFontSizeIdx((prev) => {
      const next = Math.min(Math.max(prev + delta, 0), FONT_SIZES.length - 1);
      localStorage.setItem("tl-font-size-idx", String(next));
      return next;
    });
  };
  const badge = getExplanationBadge(explanationState, explanationLoading);
  const extractionMarkdown = useMemo(() => buildExtractionMarkdown(extraction), [extraction]);
  const repeatSummary = explanationMeta?.repeat_summary;
  const hasStructuredExplanation = Boolean(
    explanationMeta?.sections?.translation_md,
  );

  const slideMessages = useMemo(
    () => (currentSlideId ? chatMessages.filter((m) => m.slideId === currentSlideId) : chatMessages),
    [currentSlideId, chatMessages],
  );

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [slideMessages]);

  // Clear translation when switching slides
  useEffect(() => {
    setTranslation("");
    translationSlideRef.current = null;
  }, [currentSlideId]);

  // Task 4: Compute which tabs have content for badge indicators
  const tabHasContent: Record<TabKey, boolean> = {
    explain: explanationState === "ready",
    translate: Boolean(translation),
    chat: slideMessages.length > 0,
    graph: false,
  };

  return (
    <section className={`flex h-full min-h-0 flex-col border border-[var(--bd-1)] bg-[var(--gd-card)] shadow-[var(--sh-panel)] ${
      isMobile ? "rounded-none border-x-0 p-2" : "rounded-[30px] p-3"
    }`}>
      {/* Tab bar + font size controls */}
      <header className="mb-1.5 shrink-0 flex items-center justify-between gap-2 md:mb-2">
        <div className="inline-flex flex-wrap gap-0.5 rounded-full border border-[var(--bd-2)] bg-[var(--sf-1)] p-0.5 shadow-sm">
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
        <div className="flex items-center gap-0.5">
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-[12px] text-[var(--tx-5)] hover:bg-[var(--sf-3)] transition-colors disabled:opacity-30"
            onClick={() => changeFontSize(-1)}
            disabled={fontSizeIdx === 0}
            type="button"
            title="缩小字体"
          >A-</button>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-[12px] text-[var(--tx-5)] hover:bg-[var(--sf-3)] transition-colors disabled:opacity-30"
            onClick={() => changeFontSize(1)}
            disabled={fontSizeIdx === FONT_SIZES.length - 1}
            type="button"
            title="放大字体"
          >A+</button>
        </div>
      </header>

      {/* ── 解析 ─────────────────────────────────────── */}
      {tab === "explain" && (
        <div key="explain" className="animate-fade-slide-in flex min-h-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-[var(--bd-2)] bg-[var(--sf-1)]">
            <header className="shrink-0 flex items-center justify-between gap-2 border-b border-[var(--bd-3)] px-3 py-2">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-medium text-[var(--tx-2)]">当前页解析</p>
                {repeatSummary?.has_repeat_section ? (
                  <span className="rounded-full border border-[var(--bd-4)] bg-[var(--sf-2)] px-2 py-0.5 text-[12px] text-[var(--tx-5)]">
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
              <div className="shrink-0 border-b border-[var(--bd-3)] px-3 py-3">
                {generationProgress ? (
                  <div className="flex items-center gap-3">
                    {/* Animated icon */}
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      generationProgress.stage === "done"
                        ? "bg-[var(--ac-green-bg)]"
                        : "bg-[var(--sf-3)]"
                    }`}>
                      {generationProgress.stage === "done" ? (
                        <svg className="h-4 w-4 text-[var(--ac-green-text)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      ) : generationProgress.stage === "vision" ? (
                        <svg className="h-4 w-4 animate-pulse text-[var(--tx-4)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                      ) : (
                        <svg className="h-4 w-4 animate-spin text-[var(--tx-4)]" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      )}
                    </div>
                    {/* Text + progress bar */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-medium text-[var(--tx-2)]">
                          {generationProgress.stage === "vision" ? "读取页面内容..." : generationProgress.stage === "text" ? "生成讲解中..." : "✓ 完成"}
                        </span>
                        <span className="tabular-nums text-[11px] text-[var(--tx-5)]">{generationProgress.elapsed}s</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sf-4)]">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${
                            generationProgress.stage === "done"
                              ? "bg-[var(--brand-sage)]"
                              : "bg-gradient-to-r from-[var(--brand-amber)] to-[var(--brand-sage)]"
                          }`}
                          style={{
                            width: generationProgress.stage === "vision"
                              ? `${Math.min(30, generationProgress.elapsed * 4)}%`
                              : generationProgress.stage === "text"
                                ? `${Math.min(92, 30 + Math.max(0, generationProgress.elapsed - 8) * 1.2)}%`
                                : "100%",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[12px] text-[var(--tx-5)]">
                      <span>解析生成中...</span>
                      <span className="animate-pulse">*</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--sf-4)]">
                      <div className="h-full w-1/2 animate-[slide_1.6s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[var(--bd-4)] via-[#e8c98a] to-[var(--bd-4)]" />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div ref={explanationRef} className="min-h-0 flex-1 overflow-auto p-3" data-note-source="explanation-content" style={{ fontSize: `${fontSize}px` }}>
              {/* Branch 1: structured JSON items available */}
              {hasStructuredExplanation && explanationMeta?.structured_items?.length ? (
                <div className="space-y-3">
                  {/* Concept chips bar — reuse ConceptHighlightedContent's pattern */}
                  <ConceptHighlightedContent
                    content=""
                    documentId={documentId}
                    slideId={currentSlideId}
                    onJumpToSlide={onJumpToSlide}
                  />
                  <StructuredContent
                    items={explanationMeta.structured_items}
                    title={explanationMeta.title}
                    contentType={explanationMeta.content_type}
                  />
                  {explanationMeta?.sections.repeat_md ? (
                    <details className="overflow-hidden rounded-[18px] border border-[var(--bd-1)] bg-[var(--sf-2)]">
                      <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-[var(--tx-4)]">
                        重复部分讲解
                        <span className="ml-2 text-[12px] font-normal text-[var(--tx-5)]">
                          来自第 {repeatSummary?.repeat_pages?.join(", ") || "前序"} 页
                        </span>
                      </summary>
                      <div className="border-t border-[var(--sf-4)] px-3 py-3">
                        <MarkdownContent content={explanationMeta.sections.repeat_md} />
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : hasStructuredExplanation ? (
                /* Branch 2: structured meta with translation_md but no JSON items */
                <div className="space-y-3">
                  <ConceptHighlightedContent
                    content={[
                      explanationMeta?.sections.translation_md ?? "",
                      explanationMeta?.sections.primary_md ?? "",
                    ].filter(Boolean).join("\n\n")}
                    documentId={documentId}
                    slideId={currentSlideId}
                    onJumpToSlide={onJumpToSlide}
                  />
                  {explanationMeta?.sections.repeat_md ? (
                    <details className="overflow-hidden rounded-[18px] border border-[var(--bd-1)] bg-[var(--sf-2)]">
                      <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-[var(--tx-4)]">
                        重复部分讲解
                        <span className="ml-2 text-[12px] font-normal text-[var(--tx-5)]">
                          来自第 {repeatSummary?.repeat_pages?.join(", ") || "前序"} 页
                        </span>
                      </summary>
                      <div className="border-t border-[var(--sf-4)] px-3 py-3">
                        <MarkdownContent content={explanationMeta.sections.repeat_md} />
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : explanation ? (
                /* Branch 3: plain markdown only */
                <ConceptHighlightedContent
                  content={explanation}
                  documentId={documentId}
                  slideId={currentSlideId}
                  onJumpToSlide={onJumpToSlide}
                />
              ) : (
                /* Branch 4: not generated */
                <div className="space-y-3">
                  {batchProgress?.isRunning ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                      <svg className="h-5 w-5 animate-spin text-[var(--tx-5)]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      <p className="text-[13px] font-medium text-[var(--tx-3)]">正在生成本页讲解...</p>
                      <p className="text-[12px] tabular-nums text-[var(--tx-5)]">
                        整体进度 {batchProgress.completed}/{batchProgress.total}
                      </p>
                    </div>
                  ) : (
                    <MarkdownContent
                      content={
                        "**当前页解析尚未生成。** 点击「生成解析」开始。"
                      }
                    />
                  )}
                  {onBatchGenerate && (
                    <button
                      className="btn btn-outline !px-3 !py-1.5 !text-[13px] gap-1.5"
                      disabled={disabled || loading || (batchProgress?.isRunning ?? false)}
                      onClick={onBatchGenerate}
                      type="button"
                    >
                      {batchProgress?.isRunning ? (
                        <>
                          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          生成中 {batchProgress.completed}/{batchProgress.total}
                        </>
                      ) : (
                        "为所有页面生成解析"
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
          <SelectionPopup
            containerRef={explanationRef}
            onElaborate={onElaborateSelection}
            disabled={disabled || loading}
          />
        </div>
      )}

      {/* ── 翻译 ─────────────────────────────────────── */}
      {tab === "translate" && (
        <div key="translate" className="animate-fade-slide-in flex min-h-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-[var(--bd-2)] bg-[var(--sf-1)]">
            <header className="shrink-0 flex items-center justify-between gap-2 border-b border-[var(--bd-3)] px-3 py-2">
              <p className="text-[13px] font-medium text-[var(--tx-2)]">中文翻译</p>
              <button
                className="btn btn-primary !px-3 !py-1.5 !text-[13px] gap-1.5"
                disabled={disabled || translationLoading}
                onClick={async () => {
                  if (!currentSlideId || !documentId) return;
                  // Don't re-translate if already done for this slide
                  if (translationSlideRef.current === currentSlideId && translation) return;
                  setTranslationLoading(true);
                  setTranslation("");
                  translationSlideRef.current = currentSlideId;
                  try {
                    const { askSlideQuestion } = await import("@/lib/api");
                    const extractText = extraction?.text || "";
                    if (!sessionId) { setTranslation("无会话，请先选择文档"); setTranslationLoading(false); return; }
                    const resp = await askSlideQuestion({
                      sessionId,
                      message: `请将以下PPT页面内容翻译成中文，输出 Markdown 格式。

格式要求（极其重要）：
- 标题用 ## 或 ###
- PPT 的一级 bullet 用 "- "（无缩进）
- PPT 的二级 bullet 用 "  - "（2个空格缩进）
- PPT 的三级 bullet 用 "    - "（4个空格缩进）
- 严格按照原始 PPT 的层级关系缩进，这是最重要的要求
- 专业术语翻译后括号保留英文原文，如：梯度下降 (Gradient Descent)
- 代码块用 \`\`\` 包裹，保持原样不翻译
- 行内公式用 $...$ 嵌在文字中
- 独立公式用 $$...$$ 且必须单独占一行，前后各空一行，例如：

翻译文字

$$E = mc^2$$

下一行文字

- 只翻译，不解释、不总结、不添加任何额外内容

原文内容：
${extractText}`,
                      slideId: currentSlideId,
                      mode: "slide",
                    });
                    if (translationSlideRef.current === currentSlideId) {
                      // Post-process: ensure $$ display math has blank lines around it
                      let text = resp.answer;
                      text = text.replace(/([^\n])\$\$/g, '$1\n\n$$');
                      text = text.replace(/\$\$([^\n])/g, '$$\n\n$1');
                      setTranslation(text);
                    }
                  } catch (err) {
                    setTranslation("翻译失败，请重试。");
                  } finally {
                    setTranslationLoading(false);
                  }
                }}
                type="button"
              >
                {translationLoading ? (
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : null}
                {translationLoading ? "翻译中…" : translation ? "重新翻译" : "生成翻译"}
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {translationLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <svg className="h-5 w-5 animate-spin text-[var(--tx-5)]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <p className="text-[13px] text-[var(--tx-5)]">正在翻译...</p>
                </div>
              ) : translation ? (
                <MarkdownContent content={translation} />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <p className="text-[13px] text-[var(--tx-5)]">点击「生成翻译」将当前页 PPT 内容翻译为中文</p>
                  <p className="text-[12px] text-[var(--tx-6)]">保留原始排版结构，不添加解释</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── 追问 ─────────────────────────────────────── */}
      {tab === "chat" && (
        <div key="chat" className="animate-fade-slide-in flex min-h-0 flex-1 flex-col">
          {/* Messages area */}
          <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
            {slideMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span className="text-2xl opacity-40">💬</span>
                <p className="text-[13px] text-[var(--tx-5)]">暂无问答记录</p>
                <p className="text-[12px] text-[var(--tx-6)]">输入问题开始对话，或框选区域进行解析。</p>
              </div>
            ) : (
              <div className="space-y-3">
                {slideMessages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end gap-2">
                      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[var(--sf-5)] px-4 py-2.5 text-[13px] text-[var(--tx-2)] shadow-sm">
                        <MarkdownContent content={m.content} />
                        {m.slideId && (
                          <p className="mt-1 text-[11px] opacity-50">第 {slidePageMap?.[m.slideId!] ?? "?"} 页</p>
                        )}
                      </div>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--sf-4)] text-[13px] text-[var(--tx-4)]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex justify-start gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--sf-3)] text-[var(--tx-4)]">
                        <span className="text-[13px]">✦</span>
                      </div>
                      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-[var(--bd-2)] bg-[var(--sf-1)] px-4 py-2.5 text-[13px] text-[var(--tx-3)] shadow-sm">
                        <MarkdownContent content={m.content} />
                        {m.slideId && (
                          <p className="mt-1 text-[11px] text-[var(--tx-6)]">第 {slidePageMap?.[m.slideId!] ?? "?"} 页</p>
                        )}
                      </div>
                    </div>
                  ),
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="shrink-0 flex flex-col gap-2 border-t border-[var(--bd-3)] px-1 pt-2.5 pb-1">
            {/* Mode pills + ROI + Clear row */}
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-full border border-[var(--bd-2)] bg-[var(--sf-3)] p-0.5">
                <button
                  className={`btn btn-segment !px-2.5 !py-0.5 !text-[11px] ${mode === "slide" ? "btn-segment-active" : "btn-segment-idle"}`}
                  onClick={() => onModeChange("slide")}
                  type="button"
                >
                  当前页
                </button>
                <button
                  className={`btn btn-segment !px-2.5 !py-0.5 !text-[11px] ${mode === "global" ? "btn-segment-active" : "btn-segment-idle"}`}
                  onClick={() => onModeChange("global")}
                  type="button"
                >
                  全局
                </button>
              </div>
              <button
                className="inline-flex items-center gap-1 rounded-full border border-[var(--bd-2)] bg-[var(--sf-2)] px-2 py-0.5 text-[11px] text-[var(--tx-4)] transition-colors hover:bg-[var(--sf-3)] disabled:opacity-40"
                disabled={disabled || loading || !roiReady}
                onClick={onExplainRoi}
                title={roiReady ? "解析框选区域" : "请先框选左侧区域"}
                type="button"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M9 3v18M3 9h18"/>
                </svg>
                {loading ? "处理中…" : "框选"}
              </button>
              {slideMessages.length > 0 && (
                <button
                  className="ml-auto rounded-full border border-[var(--bd-2)] bg-[var(--sf-2)] px-2 py-0.5 text-[11px] text-[var(--tx-5)] transition-colors hover:bg-[var(--sf-3)]"
                  onClick={onClearSlideMessages}
                  type="button"
                >
                  清空
                </button>
              )}
            </div>
            {/* Input row */}
            <div className="flex items-end gap-1.5 rounded-2xl border border-[var(--bd-1)] bg-[var(--sf-input)] p-1.5 focus-within:border-[var(--bd-4)] transition-colors">
              <textarea
                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] text-[var(--tx-3)] outline-none placeholder:text-[var(--tx-6)]"
                disabled={disabled || loading}
                onChange={(e) => onChatInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSendChat();
                }}
                placeholder="输入问题，⌘+Enter 发送"
                rows={2}
                value={chatInput}
              />
              <button
                className="shrink-0 rounded-xl bg-[var(--sf-5)] px-3 py-1.5 text-[12px] font-medium text-[var(--tx-2)] transition-opacity disabled:opacity-40"
                disabled={disabled || loading || !chatInput.trim()}
                onClick={onSendChat}
                type="button"
              >
                {loading ? (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 图谱 ─────────────────────────────────────── */}
      {tab === "graph" && (
        <div key="graph" className="animate-fade-slide-in min-h-0 flex-1 overflow-hidden rounded-[22px] border border-[var(--bd-2)] bg-[var(--sf-1)] p-3">
          {documentId ? (
            <KnowledgeGraphPanel
              documentId={documentId}
              onJumpToSlide={onJumpToSlide}
              disabled={disabled || loading}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-[var(--tx-5)]">
              请先选择文档
            </div>
          )}
        </div>
      )}

    </section>
  );
}
