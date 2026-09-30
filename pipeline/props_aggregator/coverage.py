"""Coverage reporting: markets, players, books per provider."""
from __future__ import annotations

from .schema import PropRecord


def coverage_from_records(records: list[PropRecord]) -> dict:
    """Summarize one provider's pulled records."""
    markets = sorted({r.stat for r in records})
    players = sorted({r.player for r in records})
    books = sorted({r.book for r in records if r.book})
    return {
        "records": len(records),
        "markets": markets,
        "market_count": len(markets),
        "players": len(players),
        "books": books,
        "book_count": len(books),
    }


def coverage_report(all_records: dict[str, list[PropRecord]]) -> dict:
    """all_records maps provider name -> records pulled for the week."""
    return {prov: coverage_from_records(recs) for prov, recs in all_records.items()}
