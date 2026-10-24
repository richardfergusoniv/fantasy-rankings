"""Shared HTTP plumbing and provider base class."""
from __future__ import annotations

import math
import os
import re
import time
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from typing import Any

import requests

from .schema import PropRecord, utcnow_iso

USER_AGENT = "props-aggregator/0.1 (+research; descriptive UA per provider ToS)"

# Query params whose values are credentials; several providers authenticate
# this way and requests exceptions embed the full prepared URL.
_SECRET_PARAM_RE = re.compile(
    r"([?&])([A-Za-z0-9_%-]*(?:key|token|secret|auth|sig|password)[A-Za-z0-9_%-]*)"
    r"=[^&\s]*",
    re.IGNORECASE,
)

MAX_RETRY_AFTER = 60.0


def _parse_retry_after(value: str | None, default: float = 5.0) -> float:
    """Bound Retry-After so a huge or malformed header can't stall the pull.
    Accepts numeric seconds or an HTTP-date (RFC 9110)."""
    if not value:
        return default
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            dt = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return default
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        seconds = (dt - datetime.now(timezone.utc)).total_seconds()
    if not math.isfinite(seconds):
        return default
    return max(0.0, min(seconds, MAX_RETRY_AFTER))


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

    def _scrub(self, text: str) -> str:
        """Redact secret-bearing URL query params and the API key from text
        (e.g. a requests exception message that embeds the prepared URL)."""
        text = _SECRET_PARAM_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}=***", text)
        if self.api_key:
            text = text.replace(self.api_key, "***")
        return text

    # -- http -----------------------------------------------------------
    def _get(self, url: str, params: dict | None = None,
             headers: dict | None = None, retries: int = 2) -> Any:
        delay = 1.0
        for attempt in range(retries + 1):
            try:
                resp = self.session.get(url, params=params, headers=headers,
                                        timeout=self.timeout)
            except requests.RequestException as exc:
                # `exc` may embed the prepared URL (with query-param credentials),
                # so only the scrubbed message may leave this block. Breaking and
                # raising below keeps the unsanitized exception off __context__.
                self.last_error = (
                    f"network error: {self._scrub(f'{type(exc).__name__}: {exc}')}")
                if attempt < retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
                break
            else:
                if resp.status_code == 429:
                    if attempt < retries:
                        retry_after = resp.headers.get("Retry-After")
                        time.sleep(_parse_retry_after(retry_after))
                        continue
                    raise ProviderError("rate limited (429) after retries")
                if resp.status_code in (401, 403):
                    raise ProviderError(
                        f"auth failed ({resp.status_code}): check API key/tier")
                if not resp.ok:
                    raise ProviderError(
                        f"HTTP {resp.status_code}: {self._scrub(resp.text[:200])}")
                try:
                    return resp.json()
                except ValueError:
                    # decode errors can carry the response body; raise below so
                    # nothing unsanitized rides along on __context__/__cause__
                    self.last_error = (
                        f"non-JSON response: {self._scrub(resp.text[:200])}")
                    break
        raise ProviderError(self.last_error or "unreachable") from None

    # -- interface ------------------------------------------------------
    def fetch_props(self, week: int, season: int) -> list[PropRecord]:
        raise NotImplementedError

    def coverage_hint(self) -> dict:
        """Static coverage description used by `coverage` when no data exists."""
        return {"markets": [], "players": 0, "books": []}
