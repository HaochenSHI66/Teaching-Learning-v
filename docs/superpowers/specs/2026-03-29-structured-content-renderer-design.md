# Structured JSON Content Renderer

## Problem

The backend already generates structured JSON explanations (`meta.structured_items`) via `json_renderer.py`, but the frontend ignores them and only renders the `markdown` field through `MarkdownContent`. This wastes the structured data and limits visual quality to what Markdown can express.

## Solution

Add a `StructuredContent` React component that renders `structured_items` directly as purpose-built UI components. Integrate it into the existing 3-branch rendering flow in `ai-panel.tsx`, preserving concept chips bar and repeat section.

## Data Schema (already exists in backend)

```typescript
export type ExplanationItem = {
  label: string;
  explanation: string;          // inline markdown: **bold**, $math$
  highlight: string | null;     // core conclusion sentence
  sub_items: { label: string; explanation: string }[];
  callout: {
    type: "IMPORTANT" | "TIP" | "WARNING" | "NOTE";
    text: string;
  } | null;
};
```

Backend stores these in `SlideExplanation.meta.structured_items` (via `json_renderer.build_meta_from_json`). No backend changes needed.

## Frontend Type Change

In `lib/api.ts`, export `ExplanationItem` type and add `structured_items` to `SlideExplanation.meta`:

```typescript
export type ExplanationItem = { /* as above */ };

export type SlideExplanation = {
  // ... existing fields ...
  meta?: {
    render_mode: string;
    content_type: "title" | "toc" | "intro" | "content" | "example" | "summary";
    title: string;
    // ... existing fields ...
    structured_items?: ExplanationItem[];
  } | null;
};
```

## Component Architecture

```
StructuredContent (new file: components/structured-content.tsx)
│
├── ExplanationHeader
│   - Renders meta.title as-is (already formatted: "## 第 N 页：Title — 中文主题")
│   - Strips the "## " prefix, renders as styled heading
│   - content_type badge (small pill: 讲解/例题/总结/etc.)
│
├── ExplanationItem[] (one per item)
│   ├── ItemLabel
│   │   - Left 4px brand-color border + bold label text
│   │   - Color varies by content_type (sage for content, amber for example, etc.)
│   │
│   ├── ItemBody
│   │   - Renders explanation text via ReactMarkdown (inline mode)
│   │   - Reuses remarkMath + rehypeKatex for $math$ rendering
│   │   - Reuses remarkGfm for **bold** terms
│   │   - NO [[concept]] parsing (JSON items don't contain wiki-links)
│   │
│   ├── HighlightBadge (conditional, when highlight !== null)
│   │   - Amber/gold background strip
│   │   - Renders the highlight sentence prominently
│   │
│   ├── SubItemList (conditional, when sub_items.length > 0)
│   │   - Indented list with dot markers
│   │   - Each sub-item: optional bold label + explanation (also ReactMarkdown inline)
│   │
│   └── CalloutBox (conditional, when callout !== null)
│       - 4 variants: IMPORTANT (terracotta), TIP (blue), WARNING (amber), NOTE (sage)
│       - Emoji + bold label + text
│       - Reuses existing CSS variables (--ac-terracotta-bg, etc.)
│
└── InlineMarkdown (utility sub-component)
    - Thin wrapper around ReactMarkdown with remarkMath + rehypeKatex
    - Reuses existing plugin chain, no custom regex parser
    - Renders inline content only (no block-level elements)
```

## Rendering Switch (in ai-panel.tsx)

The current rendering is a 3-branch conditional (lines 309-383). The new logic adds a 4th branch at the top while preserving all existing branches:

```tsx
{/* Branch 1 (NEW): structured JSON items available */}
{hasStructuredExplanation && explanationMeta?.structured_items?.length ? (
  <div className="space-y-3">
    {/* Concept chips bar — from ConceptHighlightedContent, extracted or kept */}
    <ConceptChipsBar documentId={documentId} slideId={currentSlideId} />
    <StructuredContent
      items={explanationMeta.structured_items}
      title={explanationMeta.title}
      contentType={explanationMeta.content_type}
    />
    {/* Preserve repeat section collapse */}
    {explanationMeta?.sections.repeat_md ? (
      <details className="...existing classes...">
        <summary>重复部分讲解 ...</summary>
        <MarkdownContent content={explanationMeta.sections.repeat_md} />
      </details>
    ) : null}
  </div>
) : hasStructuredExplanation ? (
  /* Branch 2 (EXISTING): structured meta but no JSON items — use markdown */
  <div className="space-y-3">
    <ConceptHighlightedContent content={...} ... />
    {/* repeat section as before */}
  </div>
) : explanation ? (
  /* Branch 3 (EXISTING): plain markdown only */
  <ConceptHighlightedContent content={explanation} ... />
) : (
  /* Branch 4 (EXISTING): not generated placeholder */
  <div>...</div>
)}
```

Note: `ConceptChipsBar` can be extracted from `ConceptHighlightedContent` as a standalone component, or we can wrap `StructuredContent` output in a div and prepend the chips bar. Implementation detail — not a separate component if extracting is too invasive.

Alternative simpler approach: keep `ConceptHighlightedContent` as the wrapper but pass the `StructuredContent` output as children instead of a content string. This requires a minor refactor of `ConceptHighlightedContent` to accept `children` prop.

## Visual Design

All styling uses existing CSS variables from `globals.css`:

- **Item container**: `bg-[var(--sf-1)]` with `border-l-4` using brand colors
- **Label**: `text-[var(--tx-1)]` bold, slightly larger than body
- **Body text**: `text-[var(--tx-3)]` normal weight
- **Highlight**: `bg-[var(--ac-amber-bg)]` with `border-[var(--ac-amber-border)]`
- **Callout boxes**: Reuse existing `.callout-*` styles or equivalent Tailwind
- **Spacing**: `gap-3` between items, compact but readable
- **Accessibility**: interactive elements get `role="button"`, `tabIndex={0}`, `onKeyDown`

## What Does NOT Change

- Backend: no changes to models, prompts, JSON generation, or storage
- `MarkdownContent` component: preserved as-is, used for fallback + chat + ROI + repeat sections
- `ConceptHighlightedContent`: preserved, continues to work for branches 2 & 3
- Database schema: `meta` is already a JSON column
- Chat/追问 tab: continues using Markdown
- ROI explanations: continue using Markdown
- Export functionality: continues using `markdown` field
- Batch generation: no changes
- `SelectionPopup`: continues to work (wraps the same container ref)

## Files to Create/Modify

| File | Action |
|------|--------|
| `components/structured-content.tsx` | **Create** — new StructuredContent + InlineMarkdown components |
| `components/ai-panel.tsx` | **Modify** — add branch 1 to rendering switch |
| `lib/api.ts` | **Modify** — export `ExplanationItem` type, add `structured_items` to meta |

## Edge Cases

1. **Legacy explanations** (no `structured_items`): branches 2/3/4 handle them — no breakage
2. **Empty items array**: fallback to branch 2 (existing ConceptHighlightedContent)
3. **Malformed item** (missing label/explanation): skip silently
4. **KaTeX render failure**: ReactMarkdown + rehypeKatex already handles this gracefully
5. **Very long explanations** (6+ items): natural scroll, no special handling needed
6. **Concept chips bar**: preserved via extraction or wrapper pattern
7. **Repeat section**: preserved via existing `<details>` collapse pattern
