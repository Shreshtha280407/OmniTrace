"""Visual route — architecture doc §07/§08/§09 P3.

One shared processor serves two entry points: a video's visual channel
(candidate frames merged into stable visual states) and a standalone image
(a single state of one). Each state gets two separate passes that are
deliberately not merged into one model call:

  - OCR (pytesseract, local) answers what text is literally visible —
    per-line boxes and confidence, the exact tokens lexical search needs.
  - The vision model (Groq) answers what the image means — visual type,
    a one-paragraph summary, and diagram facts (subject/relation/object
    triples). This is a paraphrase, not a transcript.

Mixing the two into one call would let the model's paraphrasing quietly
stand in for the literal OCR transcript that provenance and exact-text
retrieval depend on — see §10/§11 of the OCR route.

Candidate sampling here is fixed-interval (adaptive to video length, capped
at ~300 candidates) rather than ffmpeg scene-cut detection — the
architecture doc's own §09 P3 cut-line explicitly allows this trade
("drop the pHash merge and use fixed 10-second sampling"); we keep the
pHash+OCR merge (the valuable differentiator) and simplify only the
candidate step, which real scene-cut detection would have made more
precise but not qualitatively different.
"""

from __future__ import annotations

import asyncio
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import imagehash
import pytesseract
from PIL import Image

from omnitrace.assets import get_asset_store
from omnitrace.config import get_settings
from omnitrace.ids import new_id
from omnitrace.llm import LLMError, vision_json
from omnitrace.models import EvidenceItem, ExtractionConfidence, Location, Provenance
from pipeline.runner import ProcessorResult, ensure_timeline_id, run_stage

PROCESSOR_VERSION = "v1"

CANDIDATE_BUDGET = 300          # adaptive sampling targets roughly this many candidate frames
MIN_SAMPLE_INTERVAL_S = 1.0
PHASH_MERGE_DISTANCE = 6        # max Hamming distance to treat two frames as "the same slide"
OCR_JACCARD_MERGE_MIN = 0.7     # min token-set similarity to treat two frames as "the same slide"
MAX_STATE_LENGTH_S = 45.0       # force a new state past this even if visually static

VISION_PROMPT = (
    "You are looking at one still image (a frame from a technical video, or a standalone "
    "image). Respond with a JSON object with exactly these keys: "
    "\"visual_type\" (one of: photo, screenshot, slide, diagram, chart, table, other), "
    "\"summary\" (one paragraph describing what is shown), "
    "\"diagram_facts\" (a list of objects, each with \"subject\", \"relation\", \"object\" — "
    "extract every explicit relationship or data-flow arrow visible; empty list if none)."
)


class VisualProcessingError(Exception):
    pass


class _State:
    """One merged visual state during construction."""

    __slots__ = ("frame_path", "start_s", "end_s", "phash", "ocr_lines", "ocr_tokens")

    def __init__(self, frame_path: Path, t: float, phash: imagehash.ImageHash, ocr_lines: list[dict]) -> None:
        self.frame_path = frame_path
        self.start_s = t
        self.end_s = t
        self.phash = phash
        self.ocr_lines = ocr_lines
        self.ocr_tokens = {tok.lower() for line in ocr_lines for tok in line["text"].split()}


def _ocr_lines(image: Image.Image) -> list[dict]:
    """Group pytesseract's per-word output into per-line regions with a
    combined bounding box and mean confidence — a line is a more useful
    evidence granularity than a single word."""
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    w, h = image.size
    lines: dict[tuple[int, int, int], dict[str, Any]] = {}

    n = len(data["text"])
    for i in range(n):
        text = data["text"][i].strip()
        conf = data["conf"][i]
        if not text or conf == -1:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        left, top, width, height = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        if key not in lines:
            lines[key] = {"words": [text], "confs": [float(conf)], "x1": left, "y1": top, "x2": left + width, "y2": top + height}
        else:
            entry = lines[key]
            entry["words"].append(text)
            entry["confs"].append(float(conf))
            entry["x1"] = min(entry["x1"], left)
            entry["y1"] = min(entry["y1"], top)
            entry["x2"] = max(entry["x2"], left + width)
            entry["y2"] = max(entry["y2"], top + height)

    result = []
    for entry in lines.values():
        result.append({
            "text": " ".join(entry["words"]),
            "confidence": sum(entry["confs"]) / len(entry["confs"]) / 100.0,
            "bbox_norm": {
                "x1": round(entry["x1"] / w, 4), "y1": round(entry["y1"] / h, 4),
                "x2": round(entry["x2"] / w, 4), "y2": round(entry["y2"] / h, 4),
            },
        })
    return result


def _ocr_jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _sample_candidate_frames(video_path: Path, out_dir: Path, duration_s: float) -> list[tuple[Path, float]]:
    interval = max(MIN_SAMPLE_INTERVAL_S, duration_s / CANDIDATE_BUDGET) if duration_s > 0 else MIN_SAMPLE_INTERVAL_S
    pattern = out_dir / "frame_%05d.png"
    result = subprocess.run(
        ["ffmpeg", "-i", str(video_path), "-vf", f"fps=1/{interval}", str(pattern)],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0:
        raise VisualProcessingError(f"ffmpeg frame sampling failed: {result.stderr.strip()[:500]}")
    frames = sorted(out_dir.glob("frame_*.png"))
    return [(f, i * interval) for i, f in enumerate(frames)]


def _merge_into_states(candidates: list[tuple[Path, float]]) -> list[_State]:
    """§08 visual-state merge rule: collapse adjacent candidates into one
    state while pHash stays close, OCR content stays similar, and the
    state hasn't run past the max length."""
    states: list[_State] = []
    for frame_path, t in candidates:
        img = Image.open(frame_path)
        phash = imagehash.phash(img)
        ocr = _ocr_lines(img)

        if states:
            last = states[-1]
            tokens = {tok.lower() for line in ocr for tok in line["text"].split()}
            same_slide = (
                (phash - last.phash) <= PHASH_MERGE_DISTANCE
                and _ocr_jaccard(last.ocr_tokens, tokens) >= OCR_JACCARD_MERGE_MIN
                and (t - last.start_s) <= MAX_STATE_LENGTH_S
            )
            if same_slide:
                last.end_s = t
                continue

        states.append(_State(frame_path, t, phash, ocr))
    return states


def _cap_state_count(states: list[_State], cap: int) -> list[_State]:
    """If merging still leaves more states than the hard cap, chunk-merge
    adjacent states in equal groups until under the cap. Crude but bounded
    and correct — see §09 P3 cut-line 2."""
    if len(states) <= cap:
        return states
    group_size = -(-len(states) // cap)  # ceil division
    merged: list[_State] = []
    for i in range(0, len(states), group_size):
        chunk = states[i : i + group_size]
        head = chunk[0]
        head.end_s = chunk[-1].end_s
        merged.append(head)
    return merged


async def run_visual_stage(source_id: str) -> None:
    async def body(source_doc: dict, run_id: str) -> ProcessorResult:
        settings = get_settings()
        store = get_asset_store()
        raw_path = store.resolve(source_doc["storage_path"])
        media_type = source_doc["media_type"]
        collection_id = source_doc["collection_id"]

        evidence_items: list[EvidenceItem] = []
        warnings: list[str] = []

        if media_type == "image":
            timeline_id = None
            states_input: list[tuple[Path, float | None, float | None]] = [(raw_path, None, None)]
        else:
            timeline_id = await ensure_timeline_id(source_id)
            duration_s = (source_doc.get("duration_ms") or 0) / 1000.0
            with tempfile.TemporaryDirectory() as tmpdir:
                candidates = await asyncio.to_thread(_sample_candidate_frames, raw_path, Path(tmpdir), duration_s)
                if not candidates:
                    return ProcessorResult(metrics={"state_count": 0}, warnings=["no candidate frames extracted"])

                merged = await asyncio.to_thread(_merge_into_states, candidates)
                merged = _cap_state_count(merged, settings.max_visual_states)
                if len(merged) == settings.max_visual_states:
                    warnings.append(f"visual state count hit the cap ({settings.max_visual_states}) — states were chunk-merged")

                # Copy representative frames out of the temp dir before it's cleaned up.
                states_input = []
                for i, st in enumerate(merged):
                    persisted = store.put_file(
                        str(st.frame_path), source_id=source_id, kind="derived", filename=f"visual_state_{i:03d}.png"
                    )
                    states_input.append((store.resolve(persisted), st.start_s, st.end_s))

        for i, (frame_path, start_s, end_s) in enumerate(states_input):
            img = Image.open(frame_path)
            ocr_lines = await asyncio.to_thread(_ocr_lines, img)

            try:
                vision_result = await asyncio.to_thread(
                    vision_json, frame_path, prompt=VISION_PROMPT, model=settings.model_vision
                )
            except LLMError as e:
                warnings.append(f"vision call failed for state {i}: {e}")
                vision_result = {"visual_type": "unknown", "summary": "", "diagram_facts": []}

            visual_type = vision_result.get("visual_type", "unknown")
            summary = vision_result.get("summary", "")

            location = Location(
                timeline_id=timeline_id,
                start_ms=int(start_s * 1000) if start_s is not None else None,
                end_ms=int(end_s * 1000) if end_s is not None else None,
            )

            state_id = new_id("evidence_item")
            evidence_items.append(
                EvidenceItem(
                    _id=state_id,
                    collection_id=collection_id,
                    source_id=source_id,
                    node_type="atomic_observation",
                    evidence_type="visual_state",
                    modality="video_visual" if media_type == "video" else "image",
                    content=f"[{visual_type}] {summary}".strip(),
                    location=location,
                    provenance=Provenance(
                        processing_run_id=run_id, producer="groq_vision_adapter", model_version=settings.model_vision,
                    ),
                )
            )

            for line in ocr_lines:
                evidence_items.append(
                    EvidenceItem(
                        _id=new_id("evidence_item"),
                        collection_id=collection_id,
                        source_id=source_id,
                        parent_evidence_id=state_id,
                        node_type="atomic_observation",
                        evidence_type="ocr_region",
                        modality="video_visual" if media_type == "video" else "image",
                        content=line["text"],
                        location=Location(
                            timeline_id=timeline_id, start_ms=location.start_ms, end_ms=location.end_ms,
                            bbox_norm=line["bbox_norm"],
                        ),
                        confidence=ExtractionConfidence(extraction=line["confidence"]),
                        provenance=Provenance(processing_run_id=run_id, producer="pytesseract_adapter"),
                    )
                )

            for fact in vision_result.get("diagram_facts", []):
                subject, relation, obj = fact.get("subject"), fact.get("relation"), fact.get("object")
                if not (subject and relation and obj):
                    continue
                evidence_items.append(
                    EvidenceItem(
                        _id=new_id("evidence_item"),
                        collection_id=collection_id,
                        source_id=source_id,
                        parent_evidence_id=state_id,
                        node_type="atomic_observation",
                        evidence_type="diagram_fact",
                        modality="video_visual" if media_type == "video" else "image",
                        content=f"{subject} {relation} {obj}",
                        location=location,
                        provenance=Provenance(
                            processing_run_id=run_id, producer="groq_vision_adapter", model_version=settings.model_vision,
                        ),
                    )
                )

        state_count = sum(1 for e in evidence_items if e.evidence_type == "visual_state")
        return ProcessorResult(
            evidence_items=evidence_items,
            metrics={
                "state_count": state_count,
                "ocr_region_count": sum(1 for e in evidence_items if e.evidence_type == "ocr_region"),
                "diagram_fact_count": sum(1 for e in evidence_items if e.evidence_type == "diagram_fact"),
            },
            warnings=warnings,
        )

    await run_stage(
        source_id,
        stage="visual",
        producer="visual_processor",
        processor_version=PROCESSOR_VERSION,
        config={"processor_version": PROCESSOR_VERSION, "model": get_settings().model_vision, "max_states": get_settings().max_visual_states},
        body=body,
    )
