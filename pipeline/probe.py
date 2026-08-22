"""Probe stage — architecture doc §05/§09 P1.

Reads duration, page count, and stream validity without doing any real
extraction. This is also the corruption gate: a file that passes the
upload-time extension/size check but is not actually a readable video,
audio, image, or document fails here, with the raw source left in place
(§05: "Mark probe stage failed; raw source remains").

ffprobe covers video/audio/image (it reports streams for all three);
PyMuPDF covers documents. Kept dependency-light on purpose — no Pillow,
no ffmpeg-python wrapper, just the two tools §04 already commits to.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


class ProbeError(Exception):
    """Raised when a source's bytes don't match its declared media_type —
    the file is unreadable, has no streams, or has zero pages."""


def _run_ffprobe(path: Path) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError as e:
        raise ProbeError("ffprobe is not installed or not on PATH") from e
    except subprocess.TimeoutExpired as e:
        raise ProbeError("ffprobe timed out — file may be corrupt or unreadable") from e

    if result.returncode != 0:
        raise ProbeError(f"ffprobe rejected the file: {result.stderr.strip()[:500]}")

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise ProbeError(f"ffprobe returned unparseable output: {e}") from e

    if not data.get("streams"):
        raise ProbeError("ffprobe found no valid streams — file is likely corrupt")

    return data


def probe_video_or_audio(path: Path) -> dict[str, Any]:
    data = _run_ffprobe(path)
    fmt = data.get("format", {})
    try:
        duration_s = float(fmt.get("duration", 0.0))
    except (TypeError, ValueError):
        duration_s = 0.0
    return {"duration_ms": int(duration_s * 1000)}


def probe_image(path: Path) -> dict[str, Any]:
    # ffprobe reports a video stream for still images too (width/height/codec).
    # Nothing from this goes on the Source record yet — dimensions become
    # relevant starting P3 (visual states) — but running it here still buys
    # us the corruption check.
    _run_ffprobe(path)
    return {}


def probe_document(path: Path) -> dict[str, Any]:
    try:
        import fitz  # PyMuPDF
    except ImportError as e:
        raise ProbeError("pymupdf is not installed") from e

    try:
        doc = fitz.open(str(path))
        try:
            page_count = doc.page_count
        finally:
            doc.close()
    except ProbeError:
        raise
    except Exception as e:  # PyMuPDF raises its own exception types on bad input
        raise ProbeError(f"failed to open document: {e}") from e

    if page_count == 0:
        raise ProbeError("document has zero pages")

    return {"page_count": page_count}


def probe(media_type: str, path: Path) -> dict[str, Any]:
    """Dispatch on media_type. Returns a dict of fields to merge onto the
    Source record — {duration_ms: int} or {page_count: int} depending on
    modality. Raises ProbeError on anything unreadable."""
    if media_type in ("video", "audio"):
        return probe_video_or_audio(path)
    if media_type == "image":
        return probe_image(path)
    if media_type == "document":
        return probe_document(path)
    raise ProbeError(f"unsupported media_type: {media_type!r}")
