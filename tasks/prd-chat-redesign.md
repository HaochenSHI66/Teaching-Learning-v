# PRD: Chat System Redesign (聊天系统重构)

## Introduction

The current chat feature reuses the slide explanation engine (`generate_slide_explanation`) which is a one-shot monologue generator with no conversation awareness. This redesign creates a proper multi-turn conversational AI tutor with conversation history, streaming responses, Chinese-aware retrieval, and question-type routing.

## Goals

- Transform chat from a stateless explanation wrapper into a multi-turn conversational tutor
- Send conversation history to the model so follow-up questions work naturally
- Stream responses via SSE to eliminate 5-15s blank wait times
- Fix Chinese text retrieval so cross-slide questions actually find relevant content
- Inject cached slide explanations as context to avoid redundant re-generation
- Route different question types (clarification, deep-dive, comparison) to appropriate response strategies

## User Stories

### US-001: Create chat-specific system prompt
**Description:** As a developer, I need a dedicated chat prompt template (separate from the explanation prompt) so the model responds as a conversational tutor, not a lecturer.

**Acceptance Criteria:**
- [ ] New file `app/services/chat_prompts.py` exists
- [ ] Contains `build_chat_system_prompt(slide_context, explanation_summary)` that returns a system message
- [ ] Prompt instructs the model: "你是一个耐心的大学助教，根据学生的具体问题简洁作答，不要重复完整讲解"
- [ ] Prompt includes slide extracted text and cached explanation summary as grounding context
- [ ] Typecheck passes

### US-002: Add multi-turn message support to ModelGateway
**Description:** As a developer, I need ModelGateway to accept a full messages array (system + history + user) instead of only a single user message.

**Acceptance Criteria:**
- [ ] New method `ModelGateway.chat_completion(messages: list[dict], ...)` that accepts `[{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, ...]`
- [ ] Supports both OpenAI-compatible and Anthropic API formats
- [ ] For Anthropic: extracts system message into top-level `system` field, keeps user/assistant messages in `messages`
- [ ] Logs token usage via existing `_log_usage`
- [ ] Typecheck passes

### US-003: Create ChatEngine service
**Description:** As a developer, I need a dedicated chat engine that handles conversation context assembly, prompt construction, and model invocation.

**Acceptance Criteria:**
- [ ] New file `app/services/chat_engine.py` exists
- [ ] Function `generate_chat_response(conversation_history, slide_context, slide_image_path, question, cached_explanation)` returns answer string
- [ ] Assembles messages array: system prompt + last 8 conversation messages + current question
- [ ] Injects cached `SlideExplanation.markdown` (first 500 chars) as context in system prompt if available
- [ ] Falls back gracefully if no model configured (returns template response)
- [ ] Typecheck passes

### US-004: Rewrite chat endpoint to use ChatEngine
**Description:** As a user, I want my follow-up questions to reference previous conversation so the tutor remembers what we discussed.

**Acceptance Criteria:**
- [ ] `/api/v1/chat` endpoint queries last 10 Messages for the session from database
- [ ] Passes conversation history to `ChatEngine.generate_chat_response()`
- [ ] No longer calls `generate_slide_explanation()` for chat
- [ ] User message and assistant response still saved to Message table
- [ ] Typecheck passes

### US-005: Fix global mode to use AI
**Description:** As a user, I want global mode chat to actually use AI instead of returning a hardcoded template string.

**Acceptance Criteria:**
- [ ] When no matching slide is found, ChatEngine still generates an AI response using document-level context
- [ ] System prompt includes document title and a summary of all slides (first 100 chars of each explanation)
- [ ] Hardcoded template response on lines 136-145 of chat.py is removed
- [ ] Typecheck passes

### US-006: Fix Chinese text retrieval
**Description:** As a user, I want to ask questions in Chinese and have the system find relevant slides, since the current tokenizer only matches ASCII.

**Acceptance Criteria:**
- [ ] `retrieval.py` `_tokenize()` handles Chinese text using character bigrams (e.g. "互斥锁" → {"互斥", "斥锁"})
- [ ] ASCII tokens still extracted for English content (existing behavior preserved)
- [ ] Test: query "什么是互斥锁" matches a slide containing "互斥锁" in its extracted text
- [ ] Typecheck passes

### US-007: Add SSE streaming to ModelGateway
**Description:** As a developer, I need the ModelGateway to support streaming responses for real-time token output.

**Acceptance Criteria:**
- [ ] New method `ModelGateway.stream_chat_completion(messages)` that yields string chunks
- [ ] Uses `httpx` streaming for OpenAI-compatible API (`stream: true` in payload)
- [ ] Parses SSE `data: {...}` lines and yields `choices[0].delta.content`
- [ ] Handles `[DONE]` terminator
- [ ] Logs total usage after stream completes
- [ ] Typecheck passes

### US-008: Add SSE streaming chat endpoint
**Description:** As a user, I want to see the tutor's response appear word by word instead of waiting 5-15 seconds.

**Acceptance Criteria:**
- [ ] New endpoint `POST /api/v1/chat/stream` returns `text/event-stream` SSE response
- [ ] Each SSE event contains a JSON chunk: `{"delta": "text chunk"}`
- [ ] Final event: `{"done": true, "answer": "full text"}`
- [ ] Full response saved to Message table after stream completes
- [ ] Install `sse-starlette` package
- [ ] Typecheck passes

### US-009: Frontend SSE chat integration
**Description:** As a user, I want the chat panel to show streaming text as it arrives.

**Acceptance Criteria:**
- [ ] `api.ts` has new function `streamChatResponse(params)` using `EventSource` or `fetch` with ReadableStream
- [ ] Chat panel component calls streaming endpoint and appends chunks to displayed message
- [ ] Shows typing indicator while streaming
- [ ] Falls back to non-streaming endpoint if SSE fails
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-010: Inject cached explanations as chat context
**Description:** As a developer, I want the chat to reference the pre-generated slide explanation so it doesn't regenerate from scratch.

**Acceptance Criteria:**
- [ ] ChatEngine queries `SlideExplanation` for the current slide before calling the model
- [ ] If explanation exists, first 800 chars are included in the system prompt as "已生成的讲解摘要"
- [ ] Model is instructed to reference this context rather than re-explaining from scratch
- [ ] If no explanation exists, chat still works (just without the context)
- [ ] Typecheck passes

### US-011: Conversation context window management
**Description:** As a developer, I need to manage conversation length to stay within token budgets.

**Acceptance Criteria:**
- [ ] ChatEngine limits conversation history to last 8 messages (4 turns)
- [ ] Total estimated input tokens (system + history + context) logged for monitoring
- [ ] If history exceeds 6000 tokens, oldest messages are trimmed first
- [ ] Typecheck passes

### US-012: Question type classification and routing
**Description:** As a developer, I want to classify incoming questions to adjust the response style.

**Acceptance Criteria:**
- [ ] New function `classify_question(text)` in `chat_engine.py` returns one of: "clarification", "deep_dive", "comparison", "verification", "meta"
- [ ] Uses keyword matching (no LLM call): "什么意思/为什么/能解释" → clarification, "展开讲/详细" → deep_dive, "和第X页/区别/对比" → comparison, "对不对/是不是" → verification, "总结/这章讲了什么" → meta
- [ ] Classification appended to system prompt as instruction (e.g. "学生在请求澄清，请简洁回答，不要展开")
- [ ] Typecheck passes

### US-013: Cross-slide comparison support
**Description:** As a user, I want to ask "第3页和第7页有什么关系" and get a meaningful answer.

**Acceptance Criteria:**
- [ ] When question type is "comparison" and mentions page numbers, ChatEngine fetches context from multiple slides
- [ ] Both slides' extracted text and explanation summaries are injected as context
- [ ] System prompt instructs: "学生在对比两页内容，请分析它们的关联和区别"
- [ ] Typecheck passes

### US-014: ROI chat with conversation history
**Description:** As a user, I want ROI (region-of-interest) chat to also support follow-up questions.

**Acceptance Criteria:**
- [ ] ROI endpoint `/api/v1/chat/roi` queries conversation history like the main chat endpoint
- [ ] Previous messages about the same ROI region are included as context
- [ ] Uses ChatEngine instead of `generate_roi_explanation()` for the response
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Chat and explanation must use separate prompt templates and service classes
- FR-2: All chat responses must include conversation history from the current session
- FR-3: Chinese text must be tokenizable for slide retrieval
- FR-4: Streaming endpoint must send first token within 1 second of request
- FR-5: Chat must reference cached slide explanations instead of re-generating them
- FR-6: Question classification must not add latency (keyword-based, no LLM call)
- FR-7: Global mode must use AI, not hardcoded templates

## Non-Goals

- No voice input/output
- No image generation in chat responses
- No cross-document chat (chat is scoped to one document's session)
- No embedding-based retrieval (use improved token overlap for now; embeddings can be added later)
- No Socratic mode (Khanmigo-style guided discovery is a future enhancement)

## Technical Considerations

- ModelGateway already uses httpx which supports streaming
- Message table already has all needed fields (session_id, role, content, slide_id, mode, context)
- `sse-starlette` is the standard FastAPI SSE library
- Qwen-turbo-latest has 1M context window — more than sufficient for 8-message history + slide context
- Cost impact: ~2x token usage per chat turn (due to history), but base cost is very low (~0.002 CNY/turn)

## Success Metrics

- Follow-up questions work naturally (model references prior conversation)
- First token appears within 1 second (streaming)
- Chinese questions find relevant slides (retrieval accuracy)
- No regression in explanation generation quality

## Open Questions

- Should we add a "清空对话" (clear conversation) button in the chat panel?
- Should conversation summaries be persisted in LearningSession for cross-session memory?
