"""Settings from the environment. No literals in code — every tunable in
the architecture doc (§04, §06, §12) has a home here.

P0/P1 only need MONGODB_URI, MONGODB_DB, COLLECTION_ID and ASSET_ROOT.
Everything model/embedding-related is read lazily by later phases and is
allowed to be blank until then — validating it now would block ingestion
on credentials ingestion doesn't need.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # MongoDB Atlas
    mongodb_uri: str = Field(default="mongodb://localhost:27017", alias="MONGODB_URI")
    mongodb_db: str = Field(default="omnitrace", alias="MONGODB_DB")
    collection_id: str = Field(default="demo_architecture", alias="COLLECTION_ID")

    # Model providers — optional at P0/P1, required from P3 onward
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    model_vision: str = Field(default="claude-sonnet-5", alias="MODEL_VISION")
    model_answer: str = Field(default="claude-opus-5", alias="MODEL_ANSWER")
    model_bulk: str = Field(default="claude-haiku-4-5", alias="MODEL_BULK")

    voyage_api_key: str = Field(default="", alias="VOYAGE_API_KEY")
    embed_text: str = Field(default="voyage-3-large", alias="EMBED_TEXT")
    embed_mm: str = Field(default="voyage-multimodal-3", alias="EMBED_MM")

    # Retrieval backend — see §11, the structural hedge against a
    # not-yet-READY Atlas vector index
    vector_backend: str = Field(default="atlas", alias="VECTOR_BACKEND")

    # Storage
    asset_root: str = Field(default="./data/assets", alias="ASSET_ROOT")

    # Pipeline tuning
    max_visual_states: int = Field(default=60, alias="MAX_VISUAL_STATES")
    link_confirm: float = Field(default=0.80, alias="LINK_CONFIRM")
    link_tentative: float = Field(default=0.65, alias="LINK_TENTATIVE")

    @property
    def asset_root_path(self) -> Path:
        p = Path(self.asset_root)
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()
