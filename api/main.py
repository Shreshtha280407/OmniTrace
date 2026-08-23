"""FastAPI app — architecture doc §12 API surface.

CORS is left open. The interface layer is deferred to a separate pass
(§11), but whatever it turns out to be will be a browser client calling
this API from a different origin during development — no reason to make
that person fight CORS on day two.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import evaluation, events, query, sources
from omnitrace.db import close_client, ensure_indexes


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    yield
    await close_client()


app = FastAPI(title="OmniTrace", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sources.router, prefix="/api/v1")
app.include_router(events.router, prefix="/api/v1")
app.include_router(query.router, prefix="/api/v1")
app.include_router(evaluation.router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
