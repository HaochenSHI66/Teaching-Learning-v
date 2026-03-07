# Hybrid Model Input Design

## Goal

Upgrade explanation generation from deterministic templates to a real multimodal model pipeline that uses:
- the current slide image as visual evidence
- deterministic slide extraction as structural guidance
- server-only prompts that never reach the frontend

The same strategy should power:
- upload-time full-document explanation generation
- single-page regeneration
- ROI explanation

## Chosen Direction

Use a **hybrid input** contract rather than screenshot-only or text-only.

### Inputs to the model

For a full-page explanation request:
- the rendered slide image
- compact structured extraction text
- the page question / generation objective
- optional related-page hints

For an ROI explanation request:
- the cropped ROI image
- the full-page image
- compact structured extraction text
- ROI coordinates
- the user question

### Why this wins

- the screenshot preserves layout, formulas, diagrams, tables, emphasis, and image meaning
- the extraction payload reduces ambiguity, stabilizes wording, and improves terminology control
- the extraction payload also makes it easier to fall back when the model is unavailable

## Model Gateway

Introduce a backend-only `ModelGateway` that reads:
- `API_KEY`
- `BASE_URL`
- `MODEL`

The target endpoint should assume an OpenAI-compatible chat-completions style API because the configured environment already exposes a `/v1` compatible base and a multimodal-capable model name.

## Prompt Privacy

Prompts remain ephemeral backend inputs only.

Never send prompts to:
- frontend API responses
- stored explanation Markdown
- exports
- debugging fields rendered in the browser

## Generation Strategy

### Upload-Time

During document processing:
1. render slide
2. extract deterministic page structure
3. call the multimodal model for the page explanation
4. store only final Markdown in `SlideExplanation`

This preserves the existing product promise that explanations are pre-generated and cached locally at upload time.

### Single-Page Regeneration

The page-level regenerate action should:
- reuse the stored slide image and extraction payload
- overwrite the cached explanation
- preserve prior cached content only until the overwrite succeeds

### ROI Explanation

ROI should be upgraded from a deterministic template to a true multimodal explanation using:
- ROI crop as the primary visual
- full slide image as surrounding context
- extraction text as structural hints

## Failure Handling

If the live model call fails:
- fall back to the existing deterministic explanation builder
- mark the response as degraded internally
- keep the frontend behavior stable

This avoids blocking upload and keeps the system usable even when the model endpoint is down or rate-limited.

## Testing Strategy

- unit test: prompt strings are not embedded in stored Markdown
- unit test: gateway payload includes both image input and structured extraction text
- unit test: upload-time generation falls back cleanly when the gateway raises
- API test: full upload still produces cached explanations
- API test: single-page regeneration overwrites explanation content
- API test: ROI endpoint returns a live-model-style explanation path with fallback safety

## Scope Limits

This pass should not add:
- provider-specific SDK lock-in
- async job queue refactor
- model-side evaluation tooling
- prompt inspection UI

## References

- OpenAI-compatible multimodal pattern via chat-completions style content arrays
- PyMuPDF-based slide image and extraction payload already present in the repository
