"""Shared test fixtures.

The FastAPI app's Motor client is bound to whichever asyncio event loop is
running when it's first constructed. An in-process httpx.ASGITransport
executes the app through anyio's thread/task-group machinery, which
conflicts with Motor's own use of run_in_executor once a request takes long
enough to matter — reliably reproducible once a stage does a real network
call (Groq ASR/vision, seconds) rather than P1's near-instant local
ffprobe/PyMuPDF probes, which never triggered it. Booting a real uvicorn
server in its own thread — with its own independent event loop — avoids
the conflict entirely; this is the same shape as the manual P1 smoke test
that already proved end-to-end HTTP works cleanly.
"""

from __future__ import annotations

import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def live_server_url():
    from api.main import app

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 15
    healthy = False
    while time.time() < deadline:
        try:
            r = httpx.get(f"{base_url}/health", timeout=1.0)
            if r.status_code == 200:
                healthy = True
                break
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    if not healthy:
        raise RuntimeError("live test server did not become healthy in time")

    yield base_url

    server.should_exit = True
    thread.join(timeout=5)


def make_test_video(narration: str, on_screen_text: str, out_path: Path) -> None:
    """Build a small real video: one static frame carrying on_screen_text,
    narrated by espeak TTS for `narration`, muxed together. Cheaper than the
    full corpus generator described in the architecture doc's §05, but
    exercises the same shared-processor behavior video sources need: a real
    audio track (for the audio route) and real visible text (for the
    visual route) on one source.
    """
    with tempfile.TemporaryDirectory() as d:
        wav_path = Path(d) / "narration.wav"
        subprocess.run(["espeak", narration, "-w", str(wav_path)], capture_output=True, timeout=30, check=True)

        img_path = Path(d) / "frame.png"
        subprocess.run(
            [
                "ffmpeg", "-f", "lavfi", "-i", "color=c=white:s=640x360:d=1",
                "-vf", f"drawtext=text='{on_screen_text}':fontsize=28:fontcolor=black:x=(w-text_w)/2:y=(h-text_h)/2",
                "-frames:v", "1", "-update", "1", "-y", str(img_path),
            ],
            capture_output=True, timeout=30, check=True,
        )

        subprocess.run(
            [
                "ffmpeg", "-loop", "1", "-i", str(img_path), "-i", str(wav_path),
                "-c:v", "libx264", "-tune", "stillimage", "-c:a", "aac", "-b:a", "192k",
                "-pix_fmt", "yuv420p", "-shortest", "-y", str(out_path),
            ],
            capture_output=True, timeout=60, check=True,
        )
