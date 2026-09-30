"""Odds format conversions (American <-> decimal <-> implied probability)."""


def decimal_to_american(decimal: float) -> int | None:
    """Convert decimal odds (e.g. 1.91) to American odds (e.g. -110)."""
    if decimal is None:
        return None
    d = float(decimal)
    if d <= 1.0:
        return None
    if d >= 2.0:
        return int(round((d - 1.0) * 100))
    return int(round(-100.0 / (d - 1.0)))


def american_to_decimal(american: float) -> float | None:
    if american is None:
        return None
    a = float(american)
    if a > 0:
        return 1.0 + a / 100.0
    if a < 0:
        return 1.0 + 100.0 / abs(a)
    return None


def american_to_prob(american: float) -> float | None:
    dec = american_to_decimal(american)
    if not dec:
        return None
    return 1.0 / dec
