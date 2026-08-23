"""Grounded answer generation — architecture doc §04/§08/§09 P8.

Claude Opus 5, Structured Outputs via output_config (never assistant-turn
prefill — that returns 400 on this model family, a hard error not a
degradation), prompt caching on the fixed system prompt (cache_control:
ephemeral), thinking on by default with max_tokens >= 8000 so it isn't
truncated mid-citation. stop_reason is checked before content is touched:
a safety classifier can return HTTP 200 with an empty content array on
refusal, and code that reads content[0] unconditionally crashes on exactly
that response (§04 call-pattern rule).
"""

from __future__ import annotations

import json
from typing import Any

from generate.prompt import RESPONSE_SCHEMA, SYSTEM_PROMPT, build_user_message
from generate.validate import run_validators, validate_bundle_membership
from omnitrace.config import get_settings

GENERATION_EFFORT = "high"
MAX_TOKENS = 8000


class GenerationError(Exception):
    """Model refusal, empty content, or a response that doesn't parse as
    the required JSON shape."""


def _client():
    import anthropic

    return anthropic.Anthropic(api_key=get_settings().anthropic_api_key)


def _call_model(question: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    settings = get_settings()
    if not settings.anthropic_api_key:
        # Fail fast with the same graceful-degradation contract every other
        # provider-backed stage honors (see enrich/embed.py, pipeline/visual.py)
        # rather than letting the SDK raise an opaque auth error below.
        raise GenerationError("ANTHROPIC_API_KEY not configured")

    try:
        resp = _client().messages.create(
            model=settings.model_answer,
            max_tokens=MAX_TOKENS,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": build_user_message(question, evidence)}],
            output_config={"effort": GENERATION_EFFORT, "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}},
        )
    except Exception as e:  # noqa: BLE001 — network/auth/rate-limit errors degrade like every
        # other real network call in this codebase (Groq ASR/vision already do this); the
        # caller (api/routes/query.py, eval/run.py) only ever needs to catch GenerationError.
        raise GenerationError(f"Anthropic API call failed: {e}") from e

    # Check stop_reason BEFORE touching content — a refusal can return a
    # successful HTTP response with an empty content array (§04).
    if resp.stop_reason == "refusal":
        raise GenerationError("model declined to answer (stop_reason=refusal)")
    if not resp.content:
        raise GenerationError(f"empty response content, stop_reason={resp.stop_reason!r}")

    text_block = next((b for b in resp.content if getattr(b, "type", None) == "text"), None)
    if text_block is None:
        raise GenerationError(f"no text content in response, stop_reason={resp.stop_reason!r}")

    try:
        return json.loads(text_block.text)
    except json.JSONDecodeError as e:
        raise GenerationError(f"response did not parse as JSON despite output_config: {e}") from e


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
