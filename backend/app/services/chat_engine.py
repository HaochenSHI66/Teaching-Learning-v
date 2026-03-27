"""Conversational chat engine — separate from the explanation engine.

The explanation engine generates one-shot slide lectures (cached).
This engine handles multi-turn conversations with conversation history.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

from app.services.chat_prompts import (
    build_chat_system_prompt,
    build_global_system_prompt,
    extract_page_numbers,
)
from app.services.model_gateway import ModelGateway

logger = logging.getLogger(__name__)

# ── Token budget constants ──
_MAX_HISTORY_MESSAGES = 8   # 4 turns
_MAX_HISTORY_TOKENS = 6000
def _estimate_tokens(text: str) -> int:
    """Estimate token count with CJK-aware heuristic.

    Chinese characters typically map to ~1.5 tokens each, while ASCII text
    averages roughly 1 token per 3 characters.
    """
    if not text:
        return 1
    cjk_count = sum(1 for c in text if ord(c) > 0x4E00)
    ascii_count = len(text) - cjk_count
    tokens = cjk_count * 1.5 + ascii_count / 3
    return max(1, int(tokens))


def _trim_history(
    messages: list[dict[str, str]],
    max_messages: int = _MAX_HISTORY_MESSAGES,
    max_tokens: int = _MAX_HISTORY_TOKENS,
) -> list[dict[str, str]]:
    """Keep the most recent messages within budget."""
    # Take last N messages
    trimmed = messages[-max_messages:]
    # Then trim by token count (remove oldest first)
    total = sum(_estimate_tokens(m.get("content", "")) for m in trimmed)
    while total > max_tokens and len(trimmed) > 2:
        removed = trimmed.pop(0)
        total -= _estimate_tokens(removed.get("content", ""))
    return trimmed


# ── Question classification ──

_CLASSIFICATION_RULES: list[tuple[str, list[str]]] = [
    ("comparison", ["和第", "与第", "区别", "对比", "比较", "关系", "异同", "不同"]),
    ("verification", ["对不对", "是不是", "对吗", "是吗", "我理解的", "理解对吗", "correct"]),
    ("deep_dive", ["展开", "详细", "具体", "深入", "更多", "举个例", "例子", "elaborate"]),
    ("meta", ["总结", "概括", "这章", "整体", "大纲", "目录", "summarize", "overview"]),
    ("clarification", ["什么意思", "为什么", "怎么理解", "能解释", "不懂", "不理解", "why", "what"]),
]


def classify_question(text: str) -> str:
    """Classify a question by keyword matching. No LLM call."""
    lower = text.lower()
    for label, keywords in _CLASSIFICATION_RULES:
        if any(kw in lower for kw in keywords):
            return label
    return "clarification"  # default


# ── Main chat generation ──

def generate_chat_response(
    *,
    conversation_history: list[dict[str, str]],
    slide_context: str = "",
    slide_image_path: Path | None = None,
    question: str,
    cached_explanation: str = "",
    extra_context: str = "",
    gateway: ModelGateway | None = None,
) -> str:
    """Generate a conversational chat response with history.

    Parameters
    ----------
    conversation_history:
        Previous messages as [{"role": "user"|"assistant", "content": "..."}, ...].
    slide_context:
        Extracted text from the current slide.
    slide_image_path:
        Path to slide image (unused for now, reserved for vision chat).
    question:
        The current user question.
    cached_explanation:
        Pre-generated SlideExplanation markdown to inject as context.
    extra_context:
        Additional context (e.g. cross-slide data for comparison questions).
    gateway:
        ModelGateway instance. Uses TEXT_MODEL env vars if not provided.
    """
    question_type = classify_question(question)

    system_prompt = build_chat_system_prompt(
        slide_context=slide_context,
        explanation_summary=cached_explanation[:800] if cached_explanation else "",
        question_type=question_type,
        extra_context=extra_context,
    )

    # Assemble messages array
    trimmed = _trim_history(conversation_history)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *trimmed,
        {"role": "user", "content": question},
    ]

    total_tokens = sum(_estimate_tokens(m.get("content", "")) for m in messages)
    logger.info(
        "Chat request: type=%s, history=%d msgs, est_tokens=%d",
        question_type, len(trimmed), total_tokens,
    )

    live_gateway = gateway or ModelGateway(
        api_key=os.getenv("TEXT_API_KEY", os.getenv("API_KEY", "")),
        base_url=os.getenv("TEXT_BASE_URL", os.getenv("BASE_URL", "")),
        model=os.getenv("TEXT_MODEL", os.getenv("MODEL", "")),
        timeout=60.0,
    )

    if not live_gateway.is_configured():
        return _template_fallback(question, question_type)

    try:
        return live_gateway.chat_completion(messages)
    except Exception as exc:
        logger.warning("Chat completion failed: %s", exc)
        return _template_fallback(question, question_type)


def generate_global_chat_response(
    *,
    conversation_history: list[dict[str, str]],
    question: str,
    document_title: str = "",
    slides_summary: str = "",
    gateway: ModelGateway | None = None,
) -> str:
    """Generate a response in global mode (no specific slide selected)."""
    question_type = classify_question(question)

    system_prompt = build_global_system_prompt(
        document_title=document_title,
        slides_summary=slides_summary,
    )

    trimmed = _trim_history(conversation_history)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *trimmed,
        {"role": "user", "content": question},
    ]

    live_gateway = gateway or ModelGateway(
        api_key=os.getenv("TEXT_API_KEY", os.getenv("API_KEY", "")),
        base_url=os.getenv("TEXT_BASE_URL", os.getenv("BASE_URL", "")),
        model=os.getenv("TEXT_MODEL", os.getenv("MODEL", "")),
        timeout=60.0,
    )

    if not live_gateway.is_configured():
        return _template_fallback(question, question_type)

    try:
        return live_gateway.chat_completion(messages)
    except Exception as exc:
        logger.warning("Global chat completion failed: %s", exc)
        return _template_fallback(question, question_type)


def stream_chat_response(
    *,
    conversation_history: list[dict[str, str]],
    slide_context: str = "",
    question: str,
    cached_explanation: str = "",
    extra_context: str = "",
    gateway: ModelGateway | None = None,
):
    """Streaming version of generate_chat_response. Yields string chunks."""
    question_type = classify_question(question)

    system_prompt = build_chat_system_prompt(
        slide_context=slide_context,
        explanation_summary=cached_explanation[:800] if cached_explanation else "",
        question_type=question_type,
        extra_context=extra_context,
    )

    trimmed = _trim_history(conversation_history)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *trimmed,
        {"role": "user", "content": question},
    ]

    live_gateway = gateway or ModelGateway(
        api_key=os.getenv("TEXT_API_KEY", os.getenv("API_KEY", "")),
        base_url=os.getenv("TEXT_BASE_URL", os.getenv("BASE_URL", "")),
        model=os.getenv("TEXT_MODEL", os.getenv("MODEL", "")),
        timeout=60.0,
    )

    if not live_gateway.is_configured():
        fallback = _template_fallback(question, question_type)
        yield fallback
        return

    try:
        yield from live_gateway.stream_chat_completion(messages)
    except Exception as exc:
        logger.warning("Stream chat failed: %s", exc)
        yield _template_fallback(question, question_type)


def _template_fallback(question: str, question_type: str) -> str:
    """Fallback when no model is configured."""
    return (
        "抱歉，AI 助教暂时不可用。"
        "请稍后再试，或者点击「生成解析」查看这页的完整讲解。"
    )
