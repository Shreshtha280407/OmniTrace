"""Audio route — architecture doc §07/§09 P2.

Shared by standalone audio sources and a video's audio track (§07: video
audio goes through the same audio processor). Normalizes to mono 16kHz
WAV, transcribes via Groq Whisper with word- and segment-level timestamps,
and writes two evidence layers: atomic "utterance" observations (one per
Whisper segment — these are already natural sentence-sized chunks, so they
map cleanly onto §06's atomic-observation granularity) and coarser
semantic segments grouped for retrieval by silence gap / duration cap.

Speaker integrity (§09 P2 cut-line, matching the architecture's own
fallback table in §11): no real diarization is implemented — every
utterance gets the single stable anonymous speaker_id "spk_01", recorded
as a stage warning rather than silently omitted. A model-inferred name
never becomes a stored fact; real diarization is a documented stretch item.
"""

from __future__ import annotations

import asyncio
import math
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from omnitrace.assets import get_asset_store
from omnitrace.config import get_settings
from omnitrace.ids import new_id
from omnitrace.llm import LLMError, transcribe_audio
from omnitrace.models import EvidenceItem, ExtractionConfidence, Location, Provenance
from pipeline.runner import ProcessorResult, ensure_timeline_id, run_stage

PROCESSOR_VERSION = "v1"
DEFAULT_SPEAKER_ID = "spk_01"

# Semantic segmentation thresholds — §09 P2 build spec.
SEGMENT_GAP_MS = 2000
SEGMENT_MAX_MS = 90_000
SEGMENT_MAX_WORDS = 250


class AudioProcessingError(Exception):
    pass


def _normalize_to_wav(input_path: Path, output_path: Path) -> None:
    """ffmpeg: mono 16kHz WAV. Same command whether the input is a video
    (extracts the audio stream — -vn drops it from the output) or already
    audio (transcodes)."""
    result = subprocess.run(
        ["ffmpeg", "-i", str(input_path), "-vn", "-ac", "1", "-ar", "16000", "-y", str(output_path)],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise AudioProcessingError(f"ffmpeg audio extraction failed: {result.stderr.strip()[:500]}")


def _confidence_from_logprob(avg_logprob: float | None) -> float | None:
    """Whisper reports avg_logprob, not a 0-1 probability. exp() gives a
    bounded, monotonic pseudo-confidence — not calibrated, but sufficient
    for the linker (P6) to weight extraction quality by."""
    if avg_logprob is None:
        return None
    return max(0.0, min(1.0, math.exp(avg_logprob)))


def _group_into_segments(utterances: list[dict]) -> list[list[dict]]:
    """Group consecutive utterances into semantic segments: break on a
    >=2s gap, or when adding the next utterance would exceed the duration
    or word cap. Returns each segment as its ordered list of member
    utterance dicts."""
    if not utterances:
        return []

    segments: list[list[dict]] = [[utterances[0]]]
    seg_words = len(utterances[0]["text"].split())

    for prev, cur in zip(utterances, utterances[1:]):
        gap = cur["start_ms"] - prev["end_ms"]
        seg_start = segments[-1][0]["start_ms"]
        would_span = cur["end_ms"] - seg_start
        cur_words = len(cur["text"].split())

        if gap >= SEGMENT_GAP_MS or would_span > SEGMENT_MAX_MS or seg_words + cur_words > SEGMENT_MAX_WORDS:
            segments.append([cur])
            seg_words = cur_words
        else:
            segments[-1].append(cur)
            seg_words += cur_words

    return segments


def _transcribe(wav_path: Path, *, model: str) -> dict[str, Any]:
    return transcribe_audio(wav_path, model=model)


async def run_audio_stage(source_id: str) -> None:
    async def body(source_doc: dict, run_id: str) -> ProcessorResult:
        settings = get_settings()
        timeline_id = await ensure_timeline_id(source_id)

        store = get_asset_store()
        raw_path = store.resolve(source_doc["storage_path"])

        with tempfile.TemporaryDirectory() as tmpdir:
            wav_path = Path(tmpdir) / "audio.wav"
            await asyncio.to_thread(_normalize_to_wav, raw_path, wav_path)

            # Persist the derived WAV as a proper asset (parent lineage,
            # §06) instead of discarding it after transcription.
            derived_path = store.put_file(
                str(wav_path), source_id=source_id, kind="derived", filename="audio_16k_mono.wav"
            )

            try:
                transcript = await asyncio.to_thread(_transcribe, wav_path, model=settings.model_asr)
            except LLMError as e:
                raise AudioProcessingError(str(e)) from e

        segments_raw = transcript.get("segments", [])
        if not segments_raw:
            return ProcessorResult(
                metrics={"utterance_count": 0, "segment_count": 0},
                warnings=["transcription returned no segments — silent or unintelligible audio?"],
            )

        utterances: list[dict] = []
        atomic_items: list[EvidenceItem] = []
        for seg in segments_raw:
            text = seg["text"].strip()
            if not text:
                continue
            start_ms = int(round(float(seg["start"]) * 1000))
            end_ms = int(round(float(seg["end"]) * 1000))
            ev_id = new_id("evidence_item")
            utterances.append({"id": ev_id, "start_ms": start_ms, "end_ms": end_ms, "text": text})
            atomic_items.append(
                EvidenceItem(
                    _id=ev_id,
                    collection_id=source_doc["collection_id"],
                    source_id=source_id,
                    node_type="atomic_observation",
                    evidence_type="utterance",
                    modality="speech",
                    content=text,
                    location=Location(timeline_id=timeline_id, start_ms=start_ms, end_ms=end_ms),
                    speaker_id=DEFAULT_SPEAKER_ID,
                    confidence=ExtractionConfidence(extraction=_confidence_from_logprob(seg.get("avg_logprob"))),
                    provenance=Provenance(
                        processing_run_id=run_id,
                        producer="groq_whisper_adapter",
                        model_version=settings.model_asr,
                        derived_from=[derived_path],
                    ),
                )
            )

        semantic_items: list[EvidenceItem] = []
        for group in _group_into_segments(utterances):
            member_ids = [u["id"] for u in group]
            semantic_items.append(
                EvidenceItem(
                    _id=new_id("evidence_item"),
                    collection_id=source_doc["collection_id"],
                    source_id=source_id,
                    node_type="semantic_segment",
                    evidence_type="speech_segment",
                    modality="speech",
                    content=" ".join(u["text"] for u in group),
                    location=Location(timeline_id=timeline_id, start_ms=group[0]["start_ms"], end_ms=group[-1]["end_ms"]),
                    member_evidence_ids=member_ids,
                    speaker_id=DEFAULT_SPEAKER_ID,
                    provenance=Provenance(
                        processing_run_id=run_id, producer="audio_segmenter", derived_from=member_ids
                    ),
                )
            )

        return ProcessorResult(
            evidence_items=[*atomic_items, *semantic_items],
            metrics={
                "utterance_count": len(atomic_items),
                "segment_count": len(semantic_items),
                "duration_s": transcript.get("duration"),
                "speaker_id": DEFAULT_SPEAKER_ID,
            },
            warnings=["diarization not implemented — all utterances assigned speaker_id=spk_01 (see module docstring)"],
        )

    await run_stage(
        source_id,
        stage="audio",
        producer="groq_whisper_adapter",
        processor_version=PROCESSOR_VERSION,
        config={"processor_version": PROCESSOR_VERSION, "model": get_settings().model_asr},
        body=body,
    )
