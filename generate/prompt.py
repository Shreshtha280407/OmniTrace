"""Grounded-generation prompt construction — architecture doc §04/§08/§09 P8.

The compact bundle rendering is the entire evidence surface the model
sees: evidence ID, modality, content, and its exact locator. Nothing else
reaches the model (§08) — no raw filenames, no internal scores, no
free-form context beyond what's already in the bundle.

RESPONSE_SCHEMA deliberately has no location/timestamp/page/box fields —
the model is never given a way to state a locator itself. It only ever
names evidence_ids; api/routes/query.py re-hydrates the authoritative
location data from the stored record afterward. This is what makes
"locator authenticity" (§08's validator table) structurally guaranteed
rather than merely checked after the fact.
"""

from __future__ import annotations

from typing import Any

SYSTEM_PROMPT = (
    "You are OmniTrace's grounded-answer generator. You answer strictly from the "
    "evidence bundle you are given — you never use outside knowledge and never invent "
    "an evidence ID.\n\n"
    "Rules:\n"
    "- Every factual sentence in `answer` must be backed by at least one claim in "
    "`claims`, and every claim must cite at least one real evidence_id from the bundle.\n"
    "- If the bundle doesn't contain evidence for part of the question, say so in "
    "`missing_information` — never fill the gap from memory or plausible inference.\n"
    "- If two cited items disagree, note it in `conflicts` instead of silently picking one.\n"
    "- Never name a speaker beyond the stable ID given in the evidence (e.g. \"Speaker 1\") "
    "unless the evidence content itself contains an explicit self-introduction.\n"
    "- Cite evidence_ids only — never restate a timestamp, page, or box in your own words; "
    "the system attaches those from the database afterward."
)

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "evidence_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                    "support": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["text", "evidence_ids", "support"],
                "additionalProperties": False,
            },
        },
        "conflicts": {"type": "array", "items": {"type": "string"}},
        "missing_information": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["answer", "claims", "conflicts", "missing_information"],
    "additionalProperties": False,
}


def render_locator(item: dict[str, Any]) -> str:
    loc = item.get("location") or {}
    if loc.get("start_ms") is not None:
        return f"t={loc['start_ms']}-{loc.get('end_ms', loc['start_ms'])}ms"
    if loc.get("page") is not None:
        return f"page={loc['page']}"
    return "unlocated"


def render_bundle(evidence: list[dict[str, Any]]) -> str:
    lines = []
    for item in evidence:
        lines.append(
            f"[{item['_id']}] modality={item.get('modality')} type={item.get('evidence_type')} "
            f"locator={render_locator(item)}\n{item.get('content', '')}"
        )
    return "\n\n".join(lines)


def build_user_message(question: str, evidence: list[dict[str, Any]]) -> str:
    return (
        f"Question: {question}\n\n"
        f"Evidence bundle ({len(evidence)} items):\n\n{render_bundle(evidence)}\n\n"
        "Respond with the required JSON object only."
    )
