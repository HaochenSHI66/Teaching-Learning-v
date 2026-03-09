# Explanation Quality Repair Design

## Goal

Repair three issues in the slide explanation pipeline without expanding scope:
1. stale low-quality cached explanations remain visible to users
2. placeholder headings such as `Slide 标题` can leak into rendered explanations
3. legacy slide extracts do not contain current structured data, which weakens page understanding

## Root Causes

### 1. Cached explanations are not versioned
`slideexplanation` rows store only markdown and timestamp. Old outputs generated under older prompts are treated as current forever.

### 2. Slide extracts are not versioned
`slideextract.payload` stores JSON, but there is no schema version. Older payloads contain only raw text and summary, so the current UI shows empty `text_blocks` and `figures` even when the PDF can be re-extracted correctly.

### 3. Generated markdown is trusted too much
The model can still emit placeholder or malformed headings. We currently strip code fences, but we do not sanitize heading quality before persisting.

## Design

### A. Add explicit explanation versioning
- Add `version` to `SlideExplanation`
- Treat explanations as current only when `version == CURRENT_EXPLANATION_VERSION`
- Also mark explanations stale if markdown still contains known placeholder headings

### B. Add extract schema versioning and lazy refresh
- Store `schema_version` inside each `SlideExtract.payload`
- Introduce a document-level helper that refreshes all extracts from the original source file when any slide extract is stale
- Reuse the existing `process_document(...)` pipeline so we do not create a second extraction implementation
- Refresh is deterministic and does not call the LLM

### C. Sanitize generated explanation markdown before persistence
- Compute the best available title from `title_candidates`, `summary`, or extracted text
- Replace placeholder headings like `## Slide 标题` with the extracted title
- If no heading exists, prepend one
- Keep prompt text server-side only

### D. Tighten extraction quality slightly while touching the pipeline
- Ignore pure page-number blocks when building `text_blocks`
- Prefer semantically useful title candidates over footer noise

## API Behavior After Repair

- `/api/v1/documents/{id}/slides`
  - lazily refreshes stale extracts before responding
  - reports `explanation_state = not_generated` for stale explanations
- `/api/v1/documents/{id}/explanations`
  - returns only current explanations
- `/api/v1/documents/{id}/slides/{slide_id}/explanations/generate`
  - regenerates using current extract payload and persists current version
- `/api/v1/documents/{id}/explanations/generate`
  - refreshes stale extracts first, then regenerates all explanations
- `/api/v1/notes/autogen`
  - uses only current explanations

## Testing Strategy

1. Add an API regression test that mutates a document into a legacy state and confirms:
- slides endpoint refreshes extract structure
- stale explanation is hidden from ready state
- explanations endpoint excludes stale cached markdown

2. Add a unit test for explanation sanitization that starts with a placeholder title and verifies the stored markdown uses a real extracted title.

3. Keep existing backend and Playwright tests as end-to-end verification.
