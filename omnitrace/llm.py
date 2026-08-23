"""Model-calling layer — thin and provider-swappable.

Currently backed by Groq's OpenAI-compatible API (chat completions + audio
transcriptions). The stated end state is OpenAI once the rest of the
project is built — swapping providers means changing LLM_BASE_URL,
GROQ_API_KEY, and the model IDs in config.py. Nothing in pipeline/ imports
a provider SDK directly; everything goes through the two functions below,
written against the request/response shape both providers share.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import httpx

from omnitrace.config import get_settings


class LLMError(Exception):
    """Non-2xx response, or a response that doesn't match the expected shape."""


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {get_settings().groq_api_key}"}


def transcribe_audio(path: Path, *, model: str | None = None) -> dict[str, Any]:
    """Word- and segment-level transcription via /audio/transcriptions.

    Returns the raw provider response — text, duration, words[] (word,
    start, end — seconds), segments[] (id, start, end, text, avg_logprob,
    ...). Callers convert seconds to milliseconds and build evidence
    records; this function's job is only "call the API correctly".
    """
    settings = get_settings()
    model = model or settings.model_asr

    with open(path, "rb") as f:
        with httpx.Client(base_url=settings.llm_base_url, headers=_headers(), timeout=120.0) as client:
            resp = client.post(
                "/audio/transcriptions",
                files={"file": (path.name, f, "audio/wav")},
                # A dict value that's a list becomes repeated form fields —
                # required for OpenAI-style timestamp_granularities[]. A
                # list of (key, value) tuples, requests-style, is NOT
                # supported here and raises deep inside httpx's multipart
                # encoder (TypeError, not something that surfaces at the
                # call site) — confirmed against this httpx version directly
                # before writing this.
                data={
                    "model": model,
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": ["word", "segment"],
                },
            )

    if resp.status_code != 200:
        raise LLMError(f"transcription failed ({resp.status_code}): {resp.text[:500]}")
    return resp.json()


def vision_json(
    image_path: Path,
    *,
    prompt: str,
    model: str | None = None,
    temperature: float = 0.0,
) -> dict[str, Any]:
    """Single-image vision call constrained to JSON output.

    The caller's prompt must describe the expected JSON shape — it differs
    by use (diagram facts vs. document page summary vs. plain visual
    description), so there's no fixed schema baked in here.
    """
    settings = get_settings()
    model = model or settings.model_vision

    b64 = base64.b64encode(image_path.read_bytes()).decode()
    suffix = image_path.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            }
        ],
        "response_format": {"type": "json_object"},
        "temperature": temperature,
    }

    with httpx.Client(base_url=settings.llm_base_url, headers=_headers(), timeout=120.0) as client:
        resp = client.post("/chat/completions", json=payload)

    if resp.status_code != 200:
        raise LLMError(f"vision call failed ({resp.status_code}): {resp.text[:500]}")

    body = resp.json()
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise LLMError(f"unexpected response shape, no message content: {body!r}") from e

    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        raise LLMError(f"vision model returned non-JSON content: {e}\n{content[:500]}") from e
