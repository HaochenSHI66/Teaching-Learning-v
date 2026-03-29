from __future__ import annotations

import base64
import io
import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx
import re

logger = logging.getLogger(__name__)


def _strip_markdown_fence(text: str) -> str:
    """Remove a single outer ```markdown / ``` wrapper that LLMs sometimes add."""
    stripped = re.sub(r"^```[a-zA-Z]*\n", "", text.strip(), count=1)
    stripped = re.sub(r"\n```$", "", stripped.rstrip())
    return stripped.strip()


class ModelGateway:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.api_key = api_key or os.getenv("API_KEY", "")
        self.base_url = (base_url or os.getenv("BASE_URL", "")).rstrip("/")
        self.model = model or os.getenv("MODEL", "")
        self.timeout = timeout
        self._is_anthropic = self.model.startswith("claude")

    def is_configured(self) -> bool:
        # Keep tests deterministic unless they inject a gateway explicitly.
        if os.getenv("PYTEST_CURRENT_TEST"):
            return False
        return bool(self.api_key and self.base_url and self.model)

    def build_slide_payload(
        self,
        *,
        prompt: str,
        slide_image_path: Path,
        extraction_text: str,
    ) -> dict[str, Any]:
        return self._build_payload(
            prompt_text=f"{prompt}\n\n结构化提取：\n{extraction_text}",
            image_paths=[slide_image_path],
        )

    def build_roi_payload(
        self,
        *,
        prompt: str,
        slide_image_path: Path,
        roi_image_path: Path,
        extraction_text: str,
    ) -> dict[str, Any]:
        return self._build_payload(
            prompt_text=f"{prompt}\n\n结构化提取：\n{extraction_text}",
            image_paths=[roi_image_path, slide_image_path],
        )

    def generate_slide_markdown(
        self,
        *,
        prompt: str,
        slide_image_path: Path,
        extraction_text: str,
    ) -> str:
        payload = self.build_slide_payload(
            prompt=prompt,
            slide_image_path=slide_image_path,
            extraction_text=extraction_text,
        )
        return self._post_chat_completion(payload)

    def generate_roi_markdown(
        self,
        *,
        prompt: str,
        slide_image_path: Path,
        roi_image_path: Path,
        extraction_text: str,
    ) -> str:
        payload = self.build_roi_payload(
            prompt=prompt,
            slide_image_path=slide_image_path,
            roi_image_path=roi_image_path,
            extraction_text=extraction_text,
        )
        return self._post_chat_completion(payload)

    def generate_text_markdown(self, *, prompt: str) -> str:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
            "temperature": float(os.getenv("MODEL_TEMPERATURE", "0.2")),
            "max_tokens": 4096,
        }
        return self._post_chat_completion(payload)

    def generate_text_json(self, *, prompt: str) -> dict:
        """Call text model with response_format=json_object and return parsed dict."""
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
            "temperature": float(os.getenv("MODEL_TEMPERATURE", "0.2")),
            "max_tokens": 4096,
        }
        if not self._is_anthropic:
            payload["response_format"] = {"type": "json_object"}
        raw = self._post_chat_completion(payload)
        return json.loads(raw)

    def generate_vision_extraction(
        self,
        *,
        prompt: str,
        slide_image_path: Path,
    ) -> str:
        """Call vision model with image to extract visual content. Short output."""
        payload = self._build_payload(
            prompt_text=prompt,
            image_paths=[slide_image_path],
        )
        # Limit output tokens for extraction (short, structured output)
        if not self._is_anthropic:
            payload["max_tokens"] = 1024
        return self._post_chat_completion(payload)

    def _build_payload(self, *, prompt_text: str, image_paths: list[Path]) -> dict[str, Any]:
        if self._is_anthropic:
            return self._build_anthropic_payload(prompt_text=prompt_text, image_paths=image_paths)
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt_text}]
        for image_path in image_paths:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": self._image_to_data_url(image_path)},
                }
            )

        return {
            "model": self.model,
            "messages": [{"role": "user", "content": content}],
            "temperature": float(os.getenv("MODEL_TEMPERATURE", "0.2")),
        }

    def _build_anthropic_payload(self, *, prompt_text: str, image_paths: list[Path]) -> dict[str, Any]:
        content: list[dict[str, Any]] = []
        for image_path in image_paths:
            encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": encoded,
                },
            })
        content.append({"type": "text", "text": prompt_text})
        return {
            "model": self.model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": content}],
            "temperature": float(os.getenv("MODEL_TEMPERATURE", "0.2")),
        }

    def chat_completion(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Multi-turn chat completion with a full messages array.

        Accepts [{"role": "system", "content": "..."}, {"role": "user", ...}, ...].
        """
        temp = temperature if temperature is not None else float(os.getenv("MODEL_TEMPERATURE", "0.2"))

        if self._is_anthropic:
            # Anthropic: system goes in top-level field, not in messages
            system_text = ""
            chat_messages = []
            for msg in messages:
                if msg["role"] == "system":
                    system_text += msg["content"] + "\n"
                else:
                    chat_messages.append(msg)
            payload: dict[str, Any] = {
                "model": self.model,
                "messages": chat_messages,
                "temperature": temp,
                "max_tokens": max_tokens or 4096,
            }
            if system_text.strip():
                payload["system"] = system_text.strip()
        else:
            payload = {
                "model": self.model,
                "messages": messages,
                "temperature": temp,
            }
            if max_tokens:
                payload["max_tokens"] = max_tokens

        return self._post_chat_completion(payload)

    def stream_chat_completion(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ):
        """Streaming multi-turn chat. Yields string chunks.

        Only supports OpenAI-compatible API (not Anthropic) for now.
        """
        if not self.is_configured():
            raise RuntimeError("Model gateway is not configured")

        temp = temperature if temperature is not None else float(os.getenv("MODEL_TEMPERATURE", "0.2"))
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temp,
            "stream": True,
        }
        if max_tokens:
            payload["max_tokens"] = max_tokens

        full_output_parts: list[str] = []
        with httpx.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=self.timeout,
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[len("data: "):]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    import json as _json
                    chunk = _json.loads(data_str)
                    delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        full_output_parts.append(content)
                        yield content
                except (json.JSONDecodeError, KeyError) as exc:
                    logger.debug("Skipping malformed SSE chunk: %s", exc)
                    continue
                except Exception:
                    raise

        full_output = "".join(full_output_parts)
        if full_output:
            # Build a minimal payload for logging
            log_payload: dict[str, Any] = {"model": self.model, "messages": messages}
            self._log_usage(log_payload, full_output)

    def _extract_input_text(self, payload: dict[str, Any]) -> str:
        """Extract text portions from the payload for token estimation."""
        parts: list[str] = []
        for msg in payload.get("messages", []):
            content = msg.get("content", "")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        parts.append(item.get("text", ""))
        return "\n".join(parts)

    def _log_usage(self, payload: dict[str, Any], output_text: str) -> None:
        """Log token usage and estimated cost after a successful call."""
        try:
            from app.services.cost_tracker import log_usage
            input_text = self._extract_input_text(payload)
            log_usage(
                model=self.model,
                input_text=input_text,
                output_text=output_text,
                endpoint="chat_completion",
            )
        except Exception as exc:
            logger.debug("Cost tracking failed (non-fatal): %s", exc)

    def _post_chat_completion(self, payload: dict[str, Any], _retries: int = 2) -> str:
        if not self.is_configured():
            raise RuntimeError("Model gateway is not configured")

        if self._is_anthropic:
            result = self._post_anthropic(payload)
            self._log_usage(payload, result)
            return result

        last_error: Exception | None = None
        for attempt in range(_retries + 1):
            try:
                response = httpx.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                data = response.json()
                choices = data.get("choices") or []
                if not choices:
                    raise RuntimeError("Model gateway returned no choices")
                message = choices[0].get("message") or {}
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    result = _strip_markdown_fence(content.strip())
                    self._log_usage(payload, result)
                    return result
                if isinstance(content, list):
                    parts = [item.get("text", "") for item in content if isinstance(item, dict)]
                    merged = "\n".join(part for part in parts if part.strip()).strip()
                    if merged:
                        result = _strip_markdown_fence(merged)
                        self._log_usage(payload, result)
                        return result
                raise RuntimeError("Model gateway returned empty content")
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                last_error = exc
                if attempt < _retries:
                    import time
                    wait = 2 ** attempt
                    logger.warning("API call failed (attempt %d/%d), retrying in %ds: %s", attempt + 1, _retries + 1, wait, exc)
                    time.sleep(wait)
                    continue
                raise
        raise last_error or RuntimeError("All retries exhausted")

    def _post_anthropic(self, payload: dict[str, Any]) -> str:
        """Call the Anthropic Messages API (Claude)."""
        response = httpx.post(
            f"{self.base_url}/messages",
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        data = response.json()
        content = data.get("content") or []
        if isinstance(content, list):
            parts = [item.get("text", "") for item in content if isinstance(item, dict) and item.get("type") == "text"]
            merged = "\n".join(part for part in parts if part.strip()).strip()
            if merged:
                return _strip_markdown_fence(merged)
        raise RuntimeError("Anthropic API returned empty content")

    def _image_to_data_url(self, image_path: Path, max_width: int = 1500) -> str:
        """Convert image to base64 data URL, resizing if wider than max_width."""
        from PIL import Image

        buf = io.BytesIO()
        try:
            with Image.open(image_path) as img:
                if img.width > max_width:
                    ratio = max_width / img.width
                    new_size = (max_width, int(img.height * ratio))
                    img = img.resize(new_size, Image.LANCZOS)
                img.save(buf, format="PNG", optimize=True)
            encoded = base64.b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/png;base64,{encoded}"
        finally:
            buf.close()
