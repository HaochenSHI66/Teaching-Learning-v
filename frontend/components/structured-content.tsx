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
        // Unwrap <p> tags so content renders inline
        p: ({ children }) => <>{children}</>,
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
      className="mt-1.5 rounded-xl px-3 py-2 text-[13px] text-[var(--tx-3)]"
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
    <div className="mt-1.5 rounded-lg border border-[var(--ac-amber-border)] bg-[var(--ac-amber-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--ac-amber-text)]">
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

function ExplanationItemCard({
  item,
  contentType,
}: {
  item: ExplanationItem;
  contentType: string;
}) {
  if (!item.label && !item.explanation) return null;

  const borderColor = CONTENT_TYPE_BORDER[contentType] || "var(--brand-sage)";

  return (
    <div
      className="rounded-xl border border-[var(--bd-1)] bg-[var(--sf-1)] px-3.5 py-2.5"
      style={{ borderLeftWidth: "4px", borderLeftColor: borderColor }}
    >
      {/* Label + explanation */}
      <div className="text-[14px] leading-relaxed text-[var(--tx-3)]">
        {item.label && (
          <strong className="text-[var(--tx-1)]">{item.label}：</strong>
        )}
        <InlineMarkdown text={item.explanation} />
      </div>

      {/* Sub-items */}
      {item.sub_items?.length > 0 && (
        <ul className="mt-1.5 space-y-1 pl-4">
          {item.sub_items.map((sub, i) => (
            <li key={i} className="list-disc text-[13px] leading-relaxed text-[var(--tx-3)]">
              {sub.label && (
                <strong className="text-[var(--tx-2)]">{sub.label}：</strong>
              )}
              <InlineMarkdown text={sub.explanation} />
            </li>
          ))}
        </ul>
      )}

      {/* Highlight */}
      {item.highlight && <HighlightBadge text={item.highlight} />}

      {/* Callout */}
      {item.callout && (
        <CalloutBox type={item.callout.type} text={item.callout.text} />
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

type StructuredContentProps = {
  items: ExplanationItem[];
  title?: string;
  contentType?: string;
};

export function StructuredContent({
  items,
  title,
  contentType = "content",
}: StructuredContentProps) {
  // Parse title: strip "## " prefix if present
  const displayTitle = title?.replace(/^##\s*/, "") || "";
  const typeLabel = CONTENT_TYPE_LABEL[contentType];

  return (
    <div className="space-y-2.5">
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

      {/* Items */}
      {items.map((item, index) => (
        <ExplanationItemCard
          key={index}
          item={item}
          contentType={contentType}
        />
      ))}
    </div>
  );
}
