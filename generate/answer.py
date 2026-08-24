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
        return generate_general_answer(question)

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


# ── ungrounded fallback ────────────────────────────────────────────────────

GENERAL_SYSTEM_PROMPT = (
    "You are OmniTrace answering a question for which no source material has "
    "been provided. Answer directly and helpfully from general knowledge, the "
    "way a capable assistant would.\n\n"
    "You have NO evidence for this answer. Therefore:\n"
    "- Do not invent citations, timestamps, page numbers, filenames, or "
    "speaker names.\n"
    "- Do not claim that anything was said, shown, or written in a source.\n"
    "- If the question asks about specific content the user has not supplied "
    "(\"what did the video say\", \"summarise my document\"), say plainly that "
    "no source has been added yet, and invite them to add one.\n"
    "- If the question is answerable from general knowledge, just answer it."
)

GENERAL_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
}


def generate_general_answer(question: str) -> dict[str, Any]:
    """Answer with no evidence at all, from the model's general knowledge.

    This is the path taken when the collection is empty or retrieval returned
    nothing. It exists because a conversation with no sources yet is a normal
    state, not an error: returning a blank answer and "no evidence retrieved"
    made the product look broken the first time anyone typed into it.

    The grounding guarantee is not weakened by this, because it is not the
    same guarantee. An answer built from a bundle still may cite only IDs in
    that bundle and still reports its gaps. This answer carries
    support_label="ungrounded" and an empty source_locators list, so it is
    distinguishable from a grounded one everywhere downstream — a caller can
    never mistake it for something the evidence supports. The prompt forbids
    manufacturing the trappings of provenance precisely so that the *absence*
    of citations here is honest rather than merely unstyled.
    """
    settings = get_settings()
    if not settings.groq_api_key:
        return {
            "answer": "", "claims": [], "conflicts": [],
            "missing_information": ["no evidence retrieved, and GROQ_API_KEY is not configured"],
            "source_locators": [], "support_label": "none", "validator_warnings": [],
        }

    try:
        response = chat_json(
            [
                {
                    "role": "system",
                    "content": GENERAL_SYSTEM_PROMPT
                    + "\n\nRespond with a single JSON object and nothing else, matching "
                    "exactly this JSON Schema:\n"
                    + json.dumps(GENERAL_RESPONSE_SCHEMA),
                },
                {"role": "user", "content": question},
            ],
            model=settings.model_answer,
            temperature=0.3,
            max_tokens=MAX_TOKENS,
        )
    except LLMError as e:
        return {
            "answer": "", "claims": [], "conflicts": [],
            "missing_information": [f"generation failed: {e}"],
            "source_locators": [], "support_label": "none", "validator_warnings": [],
        }

    answer = response.get("answer", "")
    if not isinstance(answer, str):
        answer = str(answer)

    return {
        "answer": answer,
        "claims": [],
        "conflicts": [],
        "missing_information": [],
        "source_locators": [],
        "support_label": "ungrounded",
        "validator_warnings": [],
    }
