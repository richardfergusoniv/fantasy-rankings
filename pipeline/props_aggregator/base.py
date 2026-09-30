"""Shared HTTP plumbing and provider base class."""
from __future__ import annotations

import os
import time
from typing import Any

import requests

from .schema import PropRecord, utcnow_iso

USER_AGENT = "props-aggregator/0.1 (+research; descriptive UA per provider ToS)"


class ProviderError(RuntimeError):
    """A provider call failed in a way the caller should report, not crash on."""


class BaseProvider:
    """One provider client. Subclasses implement fetch_props()."""

    name: str = "base"
    env_var: str | None = None      # env var holding the API key; None = keyless
    requires_key: bool = True
    active: bool = True             # False for retired/renamed providers (stubs)
    status_note: str = ""           # human-readable status for --check-config

    def __init__(self, api_key: str | None = None, timeout: int = 30):
        self.api_key = api_key or (os.environ.get(self.env_var) if self.env_var else None)
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
        self.last_error: str | None = None

    # -- config ---------------------------------------------------------
    def check_config(self) -> list[str]:
        """Return a list of setup problems (empty = ready). No network calls."""
        if not self.active:
            return [f"{self.name}: inactive ({self.status_note})"]
        if self.requires_key and not self.api_key:
            return [f"{self.name}: missing env var {self.env_var}"]
        return []

    # -- http -----------------------------------------------------------
    def _get(self, url: str, params: dict | None = None,
             headers: dict | None = None, retries: int = 2) -> Any:
        delay = 1.0
        for attempt in range(retries + 1):
            try:
                resp = self.session.get(url, params=params, headers=headers,
                                        timeout=self.timeout)
            except requests.RequestException as exc:
                self.last_error = f"network error: {exc}"
                if attempt < retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise ProviderError(self.last_error) from exc
            if resp.status_code == 429:
                retry_after = resp.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 5)
                if attempt < retries:
                    continue
                raise ProviderError("rate limited (429) after retries")
            if resp.status_code in (401, 403):
                raise ProviderError(f"auth failed ({resp.status_code}): check API key/tier")
            if not resp.ok:
                raise ProviderError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            try:
                return resp.json()
            except ValueError as exc:
                raise ProviderError(f"non-JSON response: {resp.text[:200]}") from exc
        raise ProviderError("unreachable")

    # -- interface ------------------------------------------------------
    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        raise NotImplementedError

    def coverage_hint(self) -> dict:
        """Static coverage description used by `coverage` when no data exists."""
        return {"markets": [], "players": 0, "books": []}
