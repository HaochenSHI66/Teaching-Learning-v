# Study Workbench Redesign Design

## Goal

Upgrade the current PPT learning workbench in three directions:
- make the sidebar document list manageable, including delete actions
- redesign the interface into a more distinctive knowledge-workbench style
- replace the shallow explanation template with a fuller Chinese-first explanation strategy that annotates key terms in English and renders cleanly in Markdown

## GitHub References

- `outline/outline`: dense knowledge-product layout, restrained chrome, strong sidebar hierarchy
- `AppFlowy-IO/AppFlowy`: workspace atmosphere, layered panels, document-centric navigation
- `toeverything/AFFiNE`: card/canvas rhythm, richer visual grouping, softer surfaces

## Chosen Direction

Build a "learning studio" rather than a plain admin panel.

- Sidebar becomes a document dock with active card styling, metadata, hover tools, and destructive actions
- Main canvas gets more atmosphere: warmer paper colors, darker ink surfaces, stronger depth, and more intentional section framing
- AI panel becomes a study notebook surface with clearer segmentation between explanation, Q&A, notes, quiz, and review

## Document Management

- Add backend document deletion endpoint
- Delete all document-linked records and generated storage assets in one operation
- Add a delete control to each sidebar document card
- If the active document is deleted, automatically clear the viewer or switch to the next available document

## Explanation Prompt Strategy

Use a fuller prompt contract even before model routing is upgraded.

- Output language: Chinese
- Key concepts: Chinese explanation with English term annotation, for example `梯度（Gradient）`
- Output format: strict Markdown with headings, callouts, bold emphasis, tables only when useful, and no raw JSON
- Required sections:
  - page summary
  - core concepts
  - notation and terms
  - reasoning or example
  - pitfalls
  - quick self-check
  - suggested follow-up questions

## Markdown Rendering

- Keep GitHub-flavored Markdown support
- Improve typography, spacing, and callout surfaces
- Add styling for code blocks, lists, tables, and highlighted terms

## Testing Strategy

- TDD for backend document deletion
- Regression tests for prompt/template output expectations
- Frontend verification through `npm run build` and runtime smoke checks for sidebar actions and layout rendering
