"""Normalized prop record and canonical market list."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

# Canonical stat identifiers. Every provider's native market names map into these.
CANONICAL_MARKETS = [
    "pass_yards",
    "pass_tds",
    "pass_completions",
    "pass_attempts",
    "pass_interceptions",
    "rush_yards",
    "rush_attempts",
    "rec_yards",
    "receptions",
    "longest_reception",
    "anytime_td",
    "first_td",
    "sacks",
    "tackles",
    "kicker_points",
    "field_goals_made",
]


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class PropRecord:
    provider: str
    book: str
    player: str
    team: str = ""
    opponent: str = ""
    game_id: str = ""
    week: int = 0
    season: int = 0
    stat: str = ""
    line: float = 0.0
    over_odds: int | None = None
    under_odds: int | None = None
    fetched_at: str = field(default_factory=utcnow_iso)

    def validate(self) -> list[str]:
        problems: list[str] = []
        if not self.provider:
            problems.append("provider is empty")
        if not self.player:
            problems.append("player is empty")
        if self.stat not in CANONICAL_MARKETS:
            problems.append(f"stat {self.stat!r} is not canonical")
        try:
            float(self.line)
        except (TypeError, ValueError):
            problems.append(f"line {self.line!r} is not numeric")
        return problems

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "PropRecord":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in known})


def normalize_player(name: str) -> str:
    """Key used to group the same player across providers.

    Also strips trailing team suffixes some providers append,
    e.g. "Michael Penix Jr. (ATL)".
    """
    n = " ".join(name.strip().lower().split())
    return re.sub(r"\s*\(.*?\)\s*$", "", n).strip()
