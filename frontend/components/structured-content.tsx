"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import type { ExplanationItem } from "@/lib/api";

// ── Inline Markdown renderer ─────────────────────────────────
// Reuses the same plugin chain as MarkdownContent but for inline text.

function InlineMarkdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <ReactMarkdown
      components={{
        // Unwrap <p> for inline flow, but keep block display for display-math
        p: ({ children, ...props }) => {
          // Check if children contain a katex-display element ($$...$$)
          const childArray = Array.isArray(children) ? children : [children];
          const hasDisplayMath = childArray.some(
            (child) =>
              child && typeof child === "object" && "props" in child &&
              (child as { props?: { className?: string } }).props?.className?.includes("katex-display")
          );
          if (hasDisplayMath) {
            return <div className="my-2" {...props}>{children}</div>;
          }
          return <>{children}</>;
        },
      }}
      rehypePlugins={[rehypeKatex]}
      remarkPlugins={[remarkGfm, remarkMath]}
    >
      {text}
    </ReactMarkdown>
  );
}

// ── Callout Box ──────────────────────────────────────────────

const CALLOUT_CONFIG = {
  IMPORTANT: { emoji: "❗", label: "重点", border: "var(--brand-terracotta)", bg: "var(--ac-red-bg)" },
  TIP:       { emoji: "💡", label: "提示", border: "var(--brand-blue)",       bg: "var(--ac-muted-bg)" },
  WARNING:   { emoji: "⚠️", label: "注意", border: "var(--brand-amber)",      bg: "var(--ac-amber-bg)" },
  NOTE:      { emoji: "📌", label: "说明", border: "var(--brand-sage)",       bg: "var(--ac-green-bg)" },
} as const;

function CalloutBox({ type, text }: { type: keyof typeof CALLOUT_CONFIG; text: string }) {
  const config = CALLOUT_CONFIG[type] || CALLOUT_CONFIG.NOTE;
  return (
    <div
      className="mt-1.5 rounded-xl px-3 py-2 text-[0.9em] text-[var(--tx-3)]"
      style={{
        borderLeft: `4px solid ${config.border}`,
        background: config.bg,
      }}
    >
      <span className="mr-1">{config.emoji}</span>
      <strong className="text-[var(--tx-2)]">{config.label}：</strong>
      <InlineMarkdown text={text} />
    </div>
  );
}

// ── Highlight Badge ──────────────────────────────────────────

function HighlightBadge({ text }: { text: string }) {
  return (
    <div className="mt-1.5 rounded-lg border border-[var(--ac-amber-border)] bg-[var(--ac-amber-bg)] px-3 py-1.5 text-[0.9em] font-medium text-[var(--ac-amber-text)]">
      <InlineMarkdown text={text} />
    </div>
  );
}

// ── Content type labels ──────────────────────────────────────

const CONTENT_TYPE_LABEL: Record<string, string> = {
  title: "标题页",
  toc: "目录页",
  intro: "导入",
  content: "讲解",
  example: "例题",
  summary: "总结",
};

const CONTENT_TYPE_BORDER: Record<string, string> = {
  title: "var(--brand-olive)",
  toc: "var(--brand-olive)",
  intro: "var(--brand-blue)",
  content: "var(--brand-sage)",
  example: "var(--brand-amber)",
  summary: "var(--brand-terracotta)",
};

// ── Single Item ──────────────────────────────────────────────

const ACCENT_COLORS = [
  "var(--brand-blue)",
  "var(--brand-sage)",
  "var(--brand-amber)",
  "var(--brand-terracotta)",
  "var(--brand-olive)",
];

function ExplanationItemCard({
  item,
  contentType,
  index,
}: {
  item: ExplanationItem;
  contentType: string;
  index: number;
}) {
  if (!item.label && !item.explanation) return null;
  const accent = ACCENT_COLORS[index % ACCENT_COLORS.length];

  return (
    <div
      className="relative rounded-xl bg-[var(--sf-1)]/60 px-5 py-4"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Step number badge */}
      <span
        className="absolute -left-3 top-4 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        {index + 1}
      </span>

      {/* Main explanation */}
      <div className="markdown-body text-[1em] leading-[1.85] text-[var(--tx-3)] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:bg-[var(--sf-3)] [&_pre]:text-[var(--tx-2)]">
        {item.label && (
          <span className="font-semibold text-[#3b82c4]">
            <InlineMarkdown text={item.label + "："} />
          </span>
        )}
        <InlineMarkdown text={item.explanation} />
      </div>

      {/* Sub-items — tree line */}
      {item.sub_items?.length > 0 && (
        <ul className="markdown-body mt-3.5 space-y-2 border-l-2 border-[var(--bd-2)] pl-5 ml-1.5 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:bg-[var(--sf-3)] [&_pre]:text-[var(--tx-2)]">
          {item.sub_items.map((sub, i) => (
            <li key={i} className="text-[0.93em] leading-[1.8] text-[var(--tx-4)]">
              {sub.label && (
                <span className="font-semibold text-[#3b82c4]">
                  <InlineMarkdown text={sub.label + "："} />
                </span>
              )}
              <InlineMarkdown text={sub.explanation} />
            </li>
          ))}
        </ul>
      )}

      {/* Callout */}
      {item.callout && (
        <div className="mt-3.5">
          <CalloutBox type={item.callout.type} text={item.callout.text} />
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

type StructuredContentProps = {
  items: ExplanationItem[];
  title?: string;
  contentType?: string;
  highlightIndex?: number | null;
};

/**
 * Group adjacent "plain" items (no callout, no highlight, no sub_items) into
 * a single flowing block. Items with special annotations get their own card.
 */
function groupItems(items: ExplanationItem[]): { type: "flow"; items: ExplanationItem[] }[] | { type: "card"; item: ExplanationItem }[] {
  const groups: ({ type: "flow"; items: ExplanationItem[] } | { type: "card"; item: ExplanationItem })[] = [];
  let currentFlow: ExplanationItem[] = [];

  const isPlain = (item: ExplanationItem) =>
    !item.callout && !item.highlight && (!item.sub_items || item.sub_items.length === 0);

  for (const item of items) {
    if (isPlain(item)) {
      currentFlow.push(item);
    } else {
      if (currentFlow.length > 0) {
        groups.push({ type: "flow", items: [...currentFlow] });
        currentFlow = [];
      }
      groups.push({ type: "card", item });
    }
  }
  if (currentFlow.length > 0) {
    groups.push({ type: "flow", items: currentFlow });
  }
  return groups as any;
}

export function StructuredContent({
  items,
  title,
  contentType = "content",
  highlightIndex,
}: StructuredContentProps) {
  const displayTitle = title?.replace(/^##\s*/, "") || "";
  const typeLabel = CONTENT_TYPE_LABEL[contentType];
  const groups = groupItems(items);

  return (
    <div className="space-y-2">
      {/* Header */}
      {displayTitle && (
        <div className="flex items-start gap-2">
          <h2 className="flex-1 font-serif text-[17px] font-bold leading-snug text-[var(--tx-1)]">
            {displayTitle}
          </h2>
          {typeLabel && (
            <span className="mt-0.5 shrink-0 rounded-md border border-[var(--bd-2)] bg-[var(--sf-2)] px-1.5 py-0.5 text-[11px] text-[var(--tx-5)]">
              {typeLabel}
            </span>
          )}
        </div>
      )}

      {/* Items — numbered cards */}
      <div className="space-y-5 pl-3">
        {items.map((item, index) => (
          <div
            key={index}
            className={`rounded-xl transition-colors duration-150 ${
              highlightIndex === index
                ? "bg-blue-50 dark:bg-blue-900/20 border-l-[3px] border-blue-400 pl-2 -ml-2"
                : ""
            }`}
          >
            <ExplanationItemCard item={item} contentType={contentType} index={index} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Keep old render path for backward compatibility
function _LegacyStructuredContent({
  items,
  title,
  contentType = "content",
}: StructuredContentProps) {
  const displayTitle = title?.replace(/^##\s*/, "") || "";
  const typeLabel = CONTENT_TYPE_LABEL[contentType];
  return (
    <div className="space-y-2.5">
      {displayTitle && (
        <div className="flex items-start gap-2">
          <h2 className="flex-1 font-serif text-[17px] font-bold leading-snug text-[var(--tx-1)]">
            {displayTitle}
          </h2>
        </div>
      )}
      {items.map((item, index) => (
        <ExplanationItemCard
          key={index}
          item={item}
          contentType={contentType}
          index={index}
        />
      ))}
    </div>
  );
}
