from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from difflib import SequenceMatcher
import os
import re


TOKEN_PATTERN = re.compile(r"[a-z0-9_]+", flags=re.IGNORECASE)


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").strip().lower())


def _tokenize(text: str) -> list[str]:
    normalized = _normalize_text(text)
    tokens = TOKEN_PATTERN.findall(normalized)
    if tokens:
        return tokens
    if normalized:
        return normalized.split()
    return []


def _jaccard_score(left: Iterable[str], right: Iterable[str]) -> float:
    left_set = set(left)
    right_set = set(right)
    if not left_set or not right_set:
        return 0.0
    return len(left_set & right_set) / len(left_set | right_set)


def _character_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def _match_type_for(block: dict) -> str:
    block_type = str(block.get("type") or "")
    if block_type == "equation_like":
        return "equation"
    if block_type == "code_like":
        return "code"
    return "text"


def _candidate_blocks(payload: dict) -> list[dict]:
    blocks: list[dict] = []
    for key in ("text_blocks", "bullet_blocks", "equation_like_blocks", "code_like_blocks"):
        for block in payload.get(key) or []:
            text = str(block.get("text") or "").strip()
            if not text:
                continue
            blocks.append(
                {
                    "id": str(block.get("id") or ""),
                    "text": text,
                    "match_type": _match_type_for(block),
                    "token_count": len(_tokenize(text)),
                }
            )
    return blocks


def _window_context(assets: list[object], *, start_index: int, end_index: int) -> list[dict]:
    contexts: list[dict] = []
    for previous_asset in assets[start_index:end_index]:
        payload = getattr(previous_asset, "extract_payload", {}) or {}
        contexts.append(
            {
                "page_num": getattr(previous_asset, "page_num"),
                "summary": str(payload.get("summary") or ""),
                "title_candidates": list(payload.get("title_candidates") or []),
            }
        )
    return contexts


def _blocks_match(current: dict, previous: dict) -> tuple[bool, float]:
    if current["match_type"] != previous["match_type"]:
        return False, 0.0

    current_text = str(current["text"])
    previous_text = str(previous["text"])
    if not current_text or not previous_text:
        return False, 0.0

    current_compact = _compact_text(current_text)
    previous_compact = _compact_text(previous_text)

    if current["match_type"] == "equation":
        if current_compact == previous_compact:
            return True, 1.0
        similarity = _character_similarity(current_compact, previous_compact)
        return similarity >= 0.90, similarity

    if current["match_type"] == "code":
        if current_compact == previous_compact:
            return True, 1.0
        similarity = _character_similarity(current_compact, previous_compact)
        return similarity >= 0.92, similarity

    current_tokens = _tokenize(current_text)
    previous_tokens = _tokenize(previous_text)
    if len(current_tokens) < 4 or len(previous_tokens) < 4:
        return False, 0.0

    if current_compact == previous_compact:
        return True, 1.0

    similarity = _jaccard_score(current_tokens, previous_tokens)
    return similarity >= 0.72, similarity


def analyze_repeat_window(
    assets: list[object],
    *,
    window_size: int | None = None,
    repeated_ratio_threshold: float | None = None,
) -> None:
    if not assets:
        return

    analysis_window = window_size or int(os.getenv("REPEAT_ANALYSIS_WINDOW", "3"))
    ratio_threshold = repeated_ratio_threshold or float(os.getenv("REPEAT_RATIO_THRESHOLD", "0.30"))

    for index, asset in enumerate(assets):
        payload = getattr(asset, "extract_payload", {}) or {}
        current_blocks = _candidate_blocks(payload)
        start_index = max(0, index - analysis_window)
        previous_assets = assets[start_index:index]
        eligible_blocks = [block for block in current_blocks if block["match_type"] != "text" or block["token_count"] >= 4]
        total_tokens = sum(block["token_count"] for block in eligible_blocks)

        repeat_analysis = {
            "status": "ready",
            "window_pages": [getattr(previous, "page_num") for previous in previous_assets],
            "window_context": _window_context(assets, start_index=start_index, end_index=index),
            "repeat_pages": [],
            "repeated_ratio": 0.0,
            "new_block_ids": [],
            "repeated_block_ids": [],
            "repeated_blocks": [],
        }

        if total_tokens < 8:
            repeat_analysis["status"] = "insufficient_text"
            payload["repeat_analysis"] = repeat_analysis
            asset.extract_payload = payload
            continue

        previous_blocks: list[dict] = []
        for previous_asset in previous_assets:
            previous_payload = getattr(previous_asset, "extract_payload", {}) or {}
            for block in _candidate_blocks(previous_payload):
                previous_blocks.append(
                    {
                        **block,
                        "page_num": getattr(previous_asset, "page_num"),
                    }
                )

        repeated_token_total = 0
        repeat_pages_counter: Counter[int] = Counter()

        for current in current_blocks:
            best_match: dict | None = None
            best_similarity = 0.0
            for previous in previous_blocks:
                matched, similarity = _blocks_match(current, previous)
                if not matched or similarity < best_similarity:
                    continue
                best_similarity = similarity
                best_match = previous

            if best_match is None:
                if current["token_count"] > 0:
                    repeat_analysis["new_block_ids"].append(current["id"])
                continue

            repeat_analysis["repeated_block_ids"].append(current["id"])
            repeated_token_total += current["token_count"]
            repeat_pages_counter[int(best_match["page_num"])] += 1
            repeat_analysis["repeated_blocks"].append(
                {
                    "current_block_id": current["id"],
                    "source_page_num": int(best_match["page_num"]),
                    "source_block_id": best_match["id"],
                    "similarity": round(best_similarity, 4),
                    "match_type": current["match_type"],
                    "current_excerpt": current["text"][:180],
                    "source_excerpt": best_match["text"][:180],
                }
            )

        repeat_analysis["repeat_pages"] = sorted(repeat_pages_counter.keys())
        repeat_analysis["repeated_ratio"] = round(repeated_token_total / total_tokens, 4) if total_tokens else 0.0

        has_repeat_section = repeat_analysis["repeated_ratio"] >= ratio_threshold or any(
            count >= 2 for count in repeat_pages_counter.values()
        )
        if not has_repeat_section:
            repeat_analysis["repeated_block_ids"] = []
            repeat_analysis["repeated_blocks"] = []
            repeat_analysis["repeat_pages"] = []

        payload["repeat_analysis"] = repeat_analysis
        asset.extract_payload = payload
