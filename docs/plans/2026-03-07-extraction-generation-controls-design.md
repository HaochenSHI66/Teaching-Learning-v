# Extraction And Generation Controls Design

## Goal

Evolve the PPT learning workbench so that:
- the application stays locked to a single screen while each major module scrolls independently
- each document supports explicit explanation generation controls for the full file and the current page
- the interface distinguishes deterministic page extraction from large-model explanation generation
- explanation prompts remain strictly server-side and never appear in frontend payloads, cached Markdown, or exports

## Chosen Direction

Use a two-layer reading model:

1. **Current Page Extraction**
   - deterministic, non-LLM, always shown first
   - explains what the system extracted from the page structure
   - focuses on text blocks, figures, tables, and layout signals

2. **LLM Explanation**
   - explicit on-demand or background-generated study explanation
   - cached per slide
   - states are visible: not generated, generating, cached, regenerating

This keeps the product honest. The extraction layer shows what the system can recover directly from the file. The explanation layer is where interpretation and teaching happen.

## UI Layout And Scrolling

The full application remains `h-screen` with no document-level page scroll.

Independent scroll containers:
- top-level document sidebar
- slide thumbnail rail
- main slide canvas shell
- right-side AI panel body
- notes editor/preview area
- quiz and review lists

This preserves the single-workbench feel while keeping dense content usable on smaller screens.

## Document Controls

### Sidebar Document Card

Each document card gets:
- select/open
- delete
- `Generate All Explanations`

`Generate All Explanations` behavior:
- runs for every slide in the selected document
- overwrites existing cached explanations
- updates per-document generation status
- does not block the rest of the UI

### Explanation Panel Header

The explanation tab gets:
- `Generate This Page`
- explanation status badge

`Generate This Page` behavior:
- regenerates only the current slide
- overwrites the cached explanation for that slide
- keeps the extraction panel visible while generation runs

## Extraction Layer Without LLM

### Objective

Provide a high-quality page-structure view without pretending to understand the slide semantically.

### Recommended Stack

- **PyMuPDF**
  - page rendering
  - text blocks via `page.get_text("dict")` or `rawdict`
  - span/font/size/bbox extraction
  - image block discovery
- **pdfplumber**
  - table and line object support
  - supplemental page object inspection

### Extraction Output

For each slide, store a richer `SlideExtract.payload` shape:
- `title_candidates`
- `text_blocks`
- `bullet_blocks`
- `figures`
- `tables`
- `equation_like_blocks`
- `code_like_blocks`
- `reading_order`
- `page_stats`

Each block carries:
- stable id
- type
- bbox
- preview text if available
- ordering index

Figures should also include:
- cropped preview image path when possible
- nearby caption or adjacent text if detected

### Product Semantics

The extraction module must be labeled as extraction, not explanation.

Good:
- `Current Page Extraction`
- `Detected Structure`
- `Figure Region 1`

Bad:
- `This image means...`
- `The chart proves...`

Image and figure regions should be shown visually, but interpretation belongs to the LLM explanation layer.

## Explanation Layer

### States

Per slide:
- `not_generated`
- `generating`
- `ready`
- `error`

Per document:
- `idle`
- `generating_all`
- `ready`
- `error`

### UX Rules

- If no explanation exists yet, the explanation panel shows a callout that the slide is waiting for model generation.
- Existing cached explanations remain visible during single-page regeneration until the new result overwrites them.
- Extraction content remains visible even if explanation generation fails.

### Markdown Contract

Explanation output remains Chinese-first with English term annotations such as `导数（Derivative）`.

Expected structure:
- one-sentence summary
- core terms
- reasoning flow
- example or walkthrough
- pitfalls
- quick self-check
- suggested follow-up questions

Markdown should continue to use:
- bold
- italic
- highlight
- callouts

## Prompt Privacy

Prompt construction remains backend-internal only.

Strict rules:
- do not embed prompts in `SlideExplanation.markdown`
- do not include prompts in API responses
- do not export prompts in Markdown files
- do not add prompts to frontend debug payloads
- do not persist prompts unless a future server-side audit feature explicitly requires them

This specifically removes the current pattern of embedding `Prompt Contract` comments inside explanation Markdown.

## Backend Changes

### Data Model

Keep existing slide and explanation tables, but enrich the extraction payload and add generation status fields through API composition rather than schema churn where possible.

Recommended response additions:
- slide extraction endpoint returning structured extraction for one slide
- document generation endpoint for all slides
- single-slide generation endpoint
- explanation status in slide/document responses

### Processing Flow

Upload pipeline:
1. store document
2. render slides
3. extract deterministic structure for every slide
4. persist extraction payloads
5. optionally trigger background explanation generation for all slides

Manual regeneration:
- full document action overwrites all slide explanations
- current slide action overwrites that one explanation only

## Frontend Changes

### Right Panel Structure

The explanation tab should be split into:
1. extraction card
2. explanation card

The Q&A tab keeps ROI interaction. ROI remains a question-scoped action rather than part of passive extraction.

### Waiting State Copy

Replace misleading “core summary” copy with explicit waiting copy, for example:

> [!NOTE]
> This page is waiting for model explanation generation.
> Current extraction results are available below and can already be used for navigation and note capture.

### Notes Interaction

Notes continue to support:
- auto-generate notes from the explanation layer
- add selected explanation text into notes
- one-click formatting

Selection-based note capture should only operate on rendered explanation content, not hidden prompts.

## Error Handling

- If extraction fails, show a compact extraction error card and keep generation controls available if the slide image exists.
- If explanation generation fails, preserve prior cached explanation if one exists.
- If the full-document generation job partially fails, report document-level progress plus failed page count.

## Testing Strategy

### Backend

- unit test that explanation Markdown no longer contains prompt comments
- unit test single-page regeneration overwrites cached explanation
- unit test full-document regeneration overwrites all slide explanations
- unit test richer extraction payload shape for a rendered PDF page

### Frontend

- component test or smoke test for fixed-screen layout with module-level scrolling
- UI test for sidebar `Generate All Explanations`
- UI test for explanation-tab `Generate This Page`
- UI test that waiting state appears when explanation is absent
- UI test that extraction content renders as Markdown-safe rich cards without showing prompts

### End-To-End

Playwright smoke should cover:
- upload
- extraction panel visibility
- single-page generate
- full-document generate
- delete document
- export explanations
- notes interactions

## References

- PyMuPDF text and image block extraction: https://pymupdf.readthedocs.io/en/latest/textpage.html
- pdfplumber object and table extraction: https://github.com/jsvine/pdfplumber
- Marker (future heavier extraction option): https://github.com/datalab-to/marker
- Docling (future document-conversion upgrade path): https://arxiv.org/abs/2501.17887
