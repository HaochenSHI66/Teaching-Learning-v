# Structured Content Renderer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `meta.structured_items` as purpose-built React components instead of Markdown, with visual upgrade for slide explanations.

**Architecture:** New `StructuredContent` component reads the JSON items array already stored in `meta.structured_items` by the backend. Uses `ReactMarkdown` inline for rich text within items (bold terms, KaTeX math). Integrates into the existing 4-branch rendering conditional in `ai-panel.tsx`, preserving concept chips bar and repeat section.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, react-markdown, rehype-katex, remark-math, remark-gfm (all already installed)

**Spec:** `docs/superpowers/specs/2026-03-29-structured-content-renderer-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/lib/api.ts` | Modify (lines 150-170) | Add `ExplanationItem` type, add `structured_items` to meta |
| `frontend/components/structured-content.tsx` | Create | `StructuredContent`, `InlineMarkdown`, `CalloutBox`, `HighlightBadge` |
| `frontend/components/ai-panel.tsx` | Modify (lines 308-383) | Add branch 1: structured items rendering |

---

## Task 1: Add TypeScript Types

**Files:**
- Modify: `frontend/lib/api.ts:150-170`

- [ ] **Step 1: Add ExplanationItem type**

In `frontend/lib/api.ts`, add before the `SlideExplanation` type (before line 150):

```typescript
export type ExplanationItem = {
  label: string;
  explanation: string;
  highlight: string | null;
  sub_items: { label: string; explanation: string }[];
  callout: {
    type: "IMPORTANT" | "TIP" | "WARNING" | "NOTE";
    text: string;
  } | null;
};
```

- [ ] **Step 2: Add structured_items to meta type**

In the `SlideExplanation` type's `meta` object (around line 154-169), add after the `sections` field:

```typescript
    structured_items?: ExplanationItem[];
```

So lines 154-170 become:

```typescript
  meta?: {
    render_mode: string;
    content_type: string;
    title: string;
    repeat_summary: {
      repeat_pages: number[];
      repeated_ratio: number;
      has_repeat_section: boolean;
    };
    sections: {
      translation_md: string;
      primary_md: string;
      repeat_md?: string;
      summary_md?: string;
    };
    structured_items?: ExplanationItem[];
  } | null;
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds (type addition is non-breaking)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts
git commit -m "feat: add ExplanationItem type and structured_items to meta"
```

---

## Task 2: Create StructuredContent Component

**Files:**
- Create: `frontend/components/structured-content.tsx`

- [ ] **Step 1: Create the component file**

Create `frontend/components/structured-content.tsx` with the full implementation:

```tsx
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
  TIP:       { emoji: "💡", label: "提示", border: "var(--brand-blue)",       bg: "var(--ac-blue-bg, var(--ac-muted-bg))" },
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
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/components/structured-content.tsx
git commit -m "feat: add StructuredContent component for JSON-based rendering"
```

---

## Task 3: Integrate into AI Panel

**Files:**
- Modify: `frontend/components/ai-panel.tsx:1-12` (imports)
- Modify: `frontend/components/ai-panel.tsx:308-383` (rendering switch)

- [ ] **Step 1: Add import**

At the top of `ai-panel.tsx`, add after the existing imports (around line 8):

```typescript
import { StructuredContent } from "@/components/structured-content";
```

- [ ] **Step 2: Modify the rendering switch**

In `ai-panel.tsx`, the current 3-branch conditional starts at line 309. Replace lines 309-383 with a 4-branch conditional:

```tsx
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
```

**Note on Branch 1 concept chips:** Passing `content=""` to `ConceptHighlightedContent` will only render the concept chips bar (if concepts exist) and skip the empty markdown. If this doesn't work cleanly, an alternative is to extract the concept fetching + chips bar into a standalone `ConceptChipsBar` component. Verify during implementation and adjust.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Manual test**

1. Start the app: `cd /Users/shihaochen/github/Teaching-Learning- && docker compose up`
2. Upload a PDF and generate explanations
3. Verify:
   - Pages with `structured_items` in meta → render as cards with colored borders
   - Pages without `structured_items` → render as before (markdown)
   - Concept chips bar still appears
   - Repeat section collapse still works
   - Chat tab still works normally

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ai-panel.tsx
git commit -m "feat: integrate StructuredContent into ai-panel rendering"
```

---

## Task 4: Handle ConceptHighlightedContent Empty Content Edge Case

**Files:**
- Modify: `frontend/components/concept-highlighted-content.tsx:48-51`

After Task 3 integration, if passing `content=""` to `ConceptHighlightedContent` causes the chips bar to not render (because the component returns early with empty markdown), fix it:

- [ ] **Step 1: Check behavior**

Read `concept-highlighted-content.tsx` line 49: `if (concepts.length === 0)` returns `<MarkdownContent content={content} />`. With empty content, this renders nothing. But with concepts loaded, line 57-72 renders the chips bar + `<MarkdownContent content={content} />` — empty content is fine here, just an empty markdown div.

The real issue: if we want ONLY the chips bar (no markdown body), we should skip the `<MarkdownContent>` when content is empty.

- [ ] **Step 2: Modify to skip empty markdown**

In `concept-highlighted-content.tsx`, change lines 70-71 from:

```tsx
      <MarkdownContent content={content} className={className} />
```

to:

```tsx
      {content && <MarkdownContent content={content} className={className} />}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx next build --no-lint 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/components/concept-highlighted-content.tsx
git commit -m "fix: skip empty MarkdownContent render in ConceptHighlightedContent"
```
