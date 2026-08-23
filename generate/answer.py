"""Grounded answer generation — architecture doc §04/§08/§09 P8.

Originally spec'd against Claude Opus 5's Structured Outputs API; rerouted
to Groq's OpenAI-compatible chat completions — the same provider P2's ASR
and P3/P4's vision calls already use — per explicit direction: no
Anthropic key, not now, not later. omnitrace/llm.py's chat_json() carries
the json_object contract vision_json() already proved reliable in P3, but
json_object mode only guarantees syntactically valid JSON, not schema
conformance the way Anthropic's output_config could — so the schema is
spelled out in the system prompt, and the five validators in
generate/validate.py matter even more here: they were already written to
repair a malformed response rather than trust the provider, which is
exactly the posture this call now needs.
"""

from __future__ import annotations

import json
from typing import Any

from generate.prompt import RESPONSE_SCHEMA, SYSTEM_PROMPT, build_user_message
from generate.validate import run_validators, validate_bundle_membership
from omnitrace.config import get_settings
from omnitrace.llm import LLMError, chat_json

# 8000 was Anthropic's own "thinking mode isn't truncated mid-citation"
# minimum from the original spec — irrelevant now. Groq's free/on-demand
# tier caps openai/gpt-oss-120b at 8000 tokens PER MINUTE total (prompt +
# reserved completion budget), so requesting an 8000-token completion
# budget alone blew the cap before a single prompt token was even counted.
# A JSON answer with a handful of claims fits comfortably well under 2000.
MAX_TOKENS = 2000


class GenerationError(Exception):
    """Model refusal, empty content, or a response that doesn't parse as
    the required JSON shape."""


def _system_prompt_with_schema() -> str:
    return (
        SYSTEM_PROMPT
        + "\n\nRespond with a single JSON object and nothing else — no markdown "
        "fences, no commentary before or after it — matching exactly this JSON "
        "Schema:\n"
        + json.dumps(RESPONSE_SCHEMA)
    )


def _call_model(question: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    settings = get_settings()
    if not settings.groq_api_key:
        # Fail fast with the same graceful-degradation contract every other
        # provider-backed stage honors (see enrich/embed.py, pipeline/visual.py)
        # rather than letting the HTTP call raise an opaque auth error below.
        raise GenerationError("GROQ_API_KEY not configured")

    try:
        return chat_json(
            [
                {"role": "system", "content": _system_prompt_with_schema()},
                {"role": "user", "content": build_user_message(question, evidence)},
            ],
            model=settings.model_answer,
            temperature=0.0,
            max_tokens=MAX_TOKENS,
        )
    except LLMError as e:  # noqa: BLE001 — same degrade-not-raise contract as every other real network call here
        raise GenerationError(f"Groq generation call failed: {e}") from e


def generate_grounded_answer(question: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    """evidence is the final reranked bundle (retrieval/rerank.py output) —
    the only evidence the model ever sees. Returns the §08 response
    contract's generation-related fields (answer/claims/conflicts/
    missing_information/source_locators/support_label)."""
    allowed_ids = {e["_id"] for e in evidence}
    evidence_by_id = {e["_id"]: e for e in evidence}

    if not evidence:
        return {
            "answer": "", "claims": [], "conflicts": [],
            "missing_information": ["no evidence retrieved for this question"],
            "source_locators": [], "support_label": "none", "validator_warnings": [],
        }

    response = _call_model(question, evidence)

    issues = validate_bundle_membership(response, allowed_ids)
    if issues:
        # §08 bundle-membership fallback: regenerate once, restating the
        # allowed-ID list explicitly; if it still fails, the validators
        # below strip the bad citations regardless.
        try:
            response = _call_model(
                question + "\n\n(Your previous answer cited evidence_ids not present in the "
                f"bundle: {issues}. You may only cite these evidence_ids: {sorted(allowed_ids)}.)",
                evidence,
            )
        except GenerationError:
            pass

    response, source_locators, speaker_warnings = run_validators(
        response, allowed_ids=allowed_ids, evidence_by_id=evidence_by_id
    )

    return {
        "answer": response.get("answer", ""),
        "claims": response.get("claims", []),
        "conflicts": response.get("conflicts", []),
        "missing_information": response.get("missing_information", []),
        "source_locators": source_locators,
        "support_label": _overall_support(response),
        "validator_warnings": speaker_warnings,
    }


def _overall_support(response: dict[str, Any]) -> str:
    labels = [c.get("support", "low") for c in response.get("claims", [])]
    if not labels:
        return "none"
    if all(label == "high" for label in labels):
        return "high"
    if any(label == "low" for label in labels):
        return "low"
    return "medium"
