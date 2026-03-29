# Structured JSON Content Renderer

## Problem

The backend already generates structured JSON explanations (`meta.structured_items`) via `json_renderer.py`, but the frontend ignores them and only renders the `markdown` field through `MarkdownContent`. This wastes the structured data and limits visual quality to what Markdown can express.

## Solution

Add a `StructuredContent` React component that renders `structured_items` directly as purpose-built UI components. Fall back to `MarkdownContent` when `structured_items` is absent (legacy data, ROI explanations, chat).

## Data Schema (already exists in backend)

```typescript
type ExplanationItem = {
  label: string;
  explanation: string;          // inline markdown: **bold**, $math$, [[concept]]
  highlight: string | null;     // core conclusion sentence
  sub_items: { label: string; explanation: string }[];
  callout: {
    type: "IMPORTANT" | "TIP" | "WARNING" | "NOTE";
    text: string;
  } | null;
};
```

Backend stores these in `SlideExplanation.meta.structured_items`. No backend changes needed.

## Frontend Type Change

Add `structured_items` to the `SlideExplanation.meta` type in `lib/api.ts`:

```typescript
meta?: {
  // ... existing fields ...
  structured_items?: ExplanationItem[];
} | null;
```

## Component Architecture

```
StructuredContent (new file: components/structured-content.tsx)
├── ExplanationHeader
│   - Renders: "第 N 页：Original Title — 中文主题"
│   - content_type badge (title/toc/intro/content/example/summary)
│
├── ExplanationItem[] (one per item)
│   ├── ItemLabel
│   │   - Left 4px brand-color border + bold label text
│   │   - Color varies by content_type (sage for content, amber for example, etc.)
│   │
│   ├── ItemBody
│   │   - Renders explanation text via InlineMarkdown
│   │   - Handles **bold terms**, $math$, [[concept]] links
│   │
│   ├── HighlightBadge (conditional, when highlight !== null)
│   │   - Amber/gold background strip
│   │   - Renders the highlight sentence prominently
│   │
│   ├── SubItemList (conditional, when sub_items.length > 0)
│   │   - Indented list with dot markers
│   │   - Each sub-item has optional bold label + explanation
│   │
│   └── CalloutBox (conditional, when callout !== null)
│       - 4 variants: IMPORTANT (terracotta), TIP (blue), WARNING (amber), NOTE (sage)
│       - Emoji + bold label + text
│       - Reuses existing CSS variables (--ac-terracotta-bg, etc.)
│
└── InlineMarkdown (utility sub-component)
    - Parses **bold** → <strong>
    - Parses $math$ → KaTeX renderToString
    - Parses [[concept]] → clickable concept pill
    - Lightweight: regex-based, no full markdown parser
```

## Rendering Switch (in ai-panel.tsx)

```tsx
// In the "解析" tab content area:
{explanationMeta?.structured_items?.length ? (
  <StructuredContent
    items={explanationMeta.structured_items}
    title={explanationMeta.title}
    contentType={explanationMeta.content_type}
    pageNum={currentPageNum}
    onConceptClick={handleConceptClick}
  />
) : (
  <MarkdownContent content={explanation} onConceptClick={handleConceptClick} />
)}
```

## Visual Design

All styling uses existing CSS variables from `globals.css`:

- **Item container**: `bg-[var(--sf-1)]` with `border-l-4` using brand colors
- **Label**: `text-[var(--tx-1)]` bold, slightly larger than body
- **Body text**: `text-[var(--tx-3)]` normal weight
- **Highlight**: `bg-[var(--ac-amber-bg)]` with `border-[var(--ac-amber-border)]`
- **Callout boxes**: Reuse existing `.callout-*` styles or equivalent Tailwind
- **Concept pills**: Reuse existing concept-link styling from `MarkdownContent`
- **Spacing**: `gap-3` between items, compact but readable

## What Does NOT Change

- Backend: no changes to models, prompts, JSON generation, or storage
- `MarkdownContent` component: preserved as-is, used for fallback + chat + ROI
- Database schema: `meta` is already a JSON column
- Chat/追问 tab: continues using Markdown
- ROI explanations: continue using Markdown
- Export functionality: continues using `markdown` field
- Batch generation: no changes

## Files to Create/Modify

| File | Action |
|------|--------|
| `components/structured-content.tsx` | **Create** — new component |
| `components/ai-panel.tsx` | **Modify** — add rendering switch |
| `lib/api.ts` | **Modify** — add `structured_items` to meta type |

## Edge Cases

1. **Legacy explanations** (no `structured_items`): fallback to `MarkdownContent` — no breakage
2. **Empty items array**: fallback to `MarkdownContent`
3. **Malformed item** (missing label/explanation): skip silently
4. **KaTeX render failure**: show raw `$...$` text
5. **Very long explanations** (6+ items): natural scroll, no special handling needed
