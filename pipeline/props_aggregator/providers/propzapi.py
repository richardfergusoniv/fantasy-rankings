"""PropzAPI — INACTIVE (verified 2026-09-22).

Old directory entries describe a sports-props API at api.propzapi.com with
X-API-Key auth, but the live OpenAPI document at
https://api.propzapi.com/openapi.json now describes an unrelated
image-generation / screenshot / QR / template API. The sports product is
unavailable, renamed, or the domain was repurposed.

This stub stays inactive until a valid, current sports endpoint is supplied.
"""
from __future__ import annotations

from ..base import BaseProvider
from ..schema import PropRecord


class PropzAPIProvider(BaseProvider):
    name = "propzapi"
    env_var = "PROPZAPI_API_KEY"
    active = False
    status_note = ("domain now serves an unrelated image/QC API "
                   "(openapi.json verified 2026-09-22); sports API unavailable")

    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        raise NotImplementedError(self.status_note)
