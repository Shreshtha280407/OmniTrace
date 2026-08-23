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

The same cross-loop trap resurfaces for tests (from P5 onward) that call an
async, DB-touching function directly (e.g. NumpyVectorIndex.query,
generate_same_timeline_candidates, plan_query) instead of going through an
HTTP round trip: pytest-asyncio hands each test its own fresh event loop by
default, but the global Motor client (omnitrace/db.py's module-level
_client singleton) is already bound to the *server thread's* loop the
moment any live_server_url-using test has run. Calling coll() from a
different loop crashes with "Future attached to a different loop". The
fix isn't to give every such test its own Motor client (the functions
under test call the shared coll() directly, not an injectable one) — it's
to run that one coroutine ON the server thread's loop via
run_coroutine_threadsafe, through the `server_loop` fixture below.
"""

from __future__ import annotations

import asyncio
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
def _server_harness():
    """One real uvicorn server, in its own thread, on its own explicitly-
    created event loop (not the one asyncio.run() would create inside
    server.run() — we need a handle to it, so we build it ourselves)."""
    from api.main import app

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)

    loop_box: dict[str, asyncio.AbstractEventLoop] = {}
    loop_ready = threading.Event()

    def _run() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop_box["loop"] = loop
        loop_ready.set()
        loop.run_until_complete(server.serve())

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    if not loop_ready.wait(timeout=5):
        raise RuntimeError("server thread never created its event loop")

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

    yield base_url, loop_box["loop"]

    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture(scope="session")
def live_server_url(_server_harness):
    return _server_harness[0]


@pytest.fixture(scope="session")
def server_loop(_server_harness):
    """The live server thread's own event loop — the one the app's global
    Motor client is bound to. Pair with run_on_server_loop() to call a
    DB-touching async function directly from a test without tripping the
    cross-loop RuntimeError (see module docstring)."""
    return _server_harness[1]


async def run_on_server_loop(loop: "asyncio.AbstractEventLoop", coro):
    """Run `coro` on the live server's event loop and await its result from
    the calling test's own loop — the fix for the cross-loop Motor trap."""
    fut = asyncio.run_coroutine_threadsafe(coro, loop)
    return await asyncio.wrap_future(fut)


def cleanup_source(source_id: str) -> None:
    """Full teardown for one ingested test source: raw/derived assets, the
    source/processing_run/evidence_item records, and any entities that
    existed *only* because of this source's evidence.

    The enrich stage (P5) runs automatically on every upload — including
    every P1-P4 ingestion test — and entities.normalized_key is a globally
    unique index shared with the real demo corpus, not scoped per test.
    Deleting only evidence_items and leaving their entity mentions behind
    would permanently pollute that shared collection with test garbage
    ("Short", "Page", "trade-off", ...) across every run. Instead: pull each
    deleted evidence_id out of every entity's evidence_mentions, then drop
    any entity that pull leaves with none — i.e. one that existed only for
    this source. An entity with mentions from other (real or other-test)
    sources survives untouched.
    """
    import shutil

    from pymongo import MongoClient

    from omnitrace.assets import get_asset_store
    from omnitrace.config import get_settings

    settings = get_settings()
    db = MongoClient(settings.mongodb_uri)[settings.mongodb_db]
    store = get_asset_store()

    for kind in ("raw", "derived"):
        d = store.root / kind / source_id
        if d.exists():
            shutil.rmtree(d)

    evidence_ids = [e["_id"] for e in db["evidence_items"].find({"source_id": source_id}, {"_id": 1})]

    db["sources"].delete_one({"_id": source_id})
    db["processing_runs"].delete_many({"source_id": source_id})
    db["evidence_items"].delete_many({"source_id": source_id})

    if evidence_ids:
        db["entities"].update_many(
            {"evidence_mentions": {"$in": evidence_ids}},
            {"$pull": {"evidence_mentions": {"$in": evidence_ids}}},
        )
        db["entities"].delete_many({"evidence_mentions": {"$size": 0}})


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
