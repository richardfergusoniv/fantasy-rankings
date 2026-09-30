"""Per-provider market identifier -> canonical stat mapping.

Maps marked PROVISIONAL were inferred from docs/SDKs and must be confirmed
against live responses once keys are available. Unmapped markets are skipped
(never guessed) and reported by the coverage command.
"""

# the-odds-api style market keys, shared by The Odds API, PropLine and ParlayAPI.
# PropLine's README documents the pass/rush/receiving/TD keys for football;
# the rest follow the-odds-api's standard NFL catalog.
THEODDSAPI_MARKETS: dict[str, str | None] = {
    "player_pass_yds": "pass_yards",
    "player_pass_tds": "pass_tds",
    "player_pass_completions": "pass_completions",      # PROVISIONAL
    "player_pass_attempts": "pass_attempts",            # PROVISIONAL
    "player_pass_interceptions": "pass_interceptions",  # PROVISIONAL
    "player_rush_yds": "rush_yards",
    "player_rush_attempts": "rush_attempts",            # PROVISIONAL
    "player_reception_yds": "rec_yards",
    "player_receptions": "receptions",
    "player_reception_longest": "longest_reception",    # PROVISIONAL
    "player_anytime_td": "anytime_td",
    "player_1st_td": "first_td",
    "player_2plus_td": None,                            # ladder, no canonical stat
    "player_sacks": "sacks",                            # PROVISIONAL
    "player_tackles": "tackles",                        # PROVISIONAL
    "player_kicking_points": "kicker_points",           # PROVISIONAL
    "player_field_goals": "field_goals_made",          # PROVISIONAL
}

# Stat Pick API stat slugs (verified live 2026-09-22).
STATPICK_SLUGS: dict[str, str | None] = {
    "passing-yards": "pass_yards",
    "passing-tds": "pass_tds",
    "rushing-yards": "rush_yards",
    "receiving-yards": "rec_yards",
    "receptions": "receptions",
    "anytime-td": "anytime_td",
    "rush-rec-yards": None,  # combo market, no canonical stat
}

# Odds-API.io "Player Props" labels look like "LeBron James - Points".
# The stat half of the label maps here. PROVISIONAL for NFL labels.
ODDSAPIIO_LABELS: dict[str, str | None] = {
    "Passing Yards": "pass_yards",
    "Passing Touchdowns": "pass_tds",
    "Completions": "pass_completions",
    "Pass Attempts": "pass_attempts",
    "Interceptions": "pass_interceptions",
    "Rushing Yards": "rush_yards",
    "Rushing Attempts": "rush_attempts",
    "Receiving Yards": "rec_yards",
    "Receptions": "receptions",
    "Longest Reception": "longest_reception",
    "Anytime Touchdown": "anytime_td",
    "First Touchdown": "first_td",
    "Sacks": "sacks",
    "Tackles": "tackles",
}

# SportsGameOdds oddIDs are statID-statEntityID-periodID-betTypeID-sideID.
# statID values for NFL player props are discovered at runtime; these are
# provisional guesses logged loudly when they miss.
# SportsGameOdds statIDs for NFL player props.
# Discovered live 2026-09-22 from /events oddIDs
# (statID-statEntityID-periodID-betTypeID-sideID).
# None = noncanonical/combo/fantasy/team market: skipped, never guessed.
SGO_STAT_IDS: dict[str, str | None] = {
    "touchdowns": "anytime_td",  # ou; alt lines possible (e.g. 1.5)
    "firstTouchdown": "first_td",  # yn-yes binary -> implicit 0.5
    "passing_yards": "pass_yards",
    "passing_touchdowns": "pass_tds",
    "passing_completions": "pass_completions",
    "passing_attempts": "pass_attempts",
    "passing_interceptions": "pass_interceptions",
    "rushing_yards": "rush_yards",
    "rushing_attempts": "rush_attempts",
    "receiving_yards": "rec_yards",
    "receiving_receptions": "receptions",
    "receiving_longestReception": "longest_reception",
    "defense_sacks": "sacks",
    "defense_combinedTackles": "tackles",
    "fieldGoals_made": "field_goals_made",
    "kicking_totalPoints": "kicker_points",
    "lastTouchdown": None,
    "rushing+receiving_yards": None,
    "passing+rushing_yards": None,
    "fantasyScore": None,
    "rushing_longestRush": None,
    "passing_longestCompletion": None,
    "receiving_targets": None,
    "extraPoints_kicksMade": None,
    "rushing_touchdowns": None,
    "rushing_yardsPerAttempt": None,
    "defense_soloTackles": None,
    "defense_assistedTackles": None,
}

# RapidOddsAPI market_type values for NFL player props (from coverage page).
# PROVISIONAL: confirm against the coverage endpoint once a key exists.
RAPIDODDS_MARKETS: dict[str, str | None] = {
    "player_pass_yards": "pass_yards",
    "player_pass_touchdowns": "pass_tds",
    "player_rush_yards": "rush_yards",
    "player_receiving_yards": "rec_yards",
    "player_receptions": "receptions",
    "player_anytime_td": "anytime_td",
}


# SharpAPI market catalog ids (GET /api/v1/markets, verified live 2026-09-22)
# -> canonical stat. The /odds `market` filter takes these ids and each row's
# market_type matches the queried id. Binary TD-scorer markets have one row
# per player (selection_type "other", no line); the client treats them as
# implicit 0.5 lines, like PropLine's binary markets.
# Combos (rushing+receiving, passing+rushing, tackles+assists) and markets with
# no canonical stat (extra points, longest completion/rush, fantasy score,
# defensive interceptions, last-TD scorer, ambiguous player_touchdowns)
# map to None and are skipped, logged by the provider — never guessed.
SHARPAPI_MARKETS: dict[str, str | None] = {
    "player_passing_yards": "pass_yards",
    "player_passing_touchdowns": "pass_tds",
    "player_passing_completions": "pass_completions",
    "player_passing_attempts": "pass_attempts",
    "player_interceptions": "pass_interceptions",
    "player_rushing_yards": "rush_yards",
    "player_rushing_attempts": "rush_attempts",
    "player_receiving_yards": "rec_yards",
    "player_receptions": "receptions",
    "player_longest_reception": "longest_reception",
    "player_kicking_points": "kicker_points",
    "player_field_goals_made": "field_goals_made",
    "player_sacks": "sacks",
    "player_tackles": "tackles",
    "anytime_touchdown_scorer": "anytime_td",
    "first_touchdown_scorer": "first_td",
    "player_extra_points_made": None,
    "player_longest_passing_completion": None,
    "player_longest_rush": None,
    "player_passing_+_rushing_yards": None,
    "player_rushing_+_receiving_yards": None,
    "player_tackles_+_assists": None,
    "player_defensive_interceptions": None,
    "player_fantasy_score": None,
    "last_touchdown_scorer": None,
    "player_touchdowns": None,
}

def map_market(provider_map: dict[str, str | None], native: str) -> str | None:
    """Return the canonical stat for a native market id, or None to skip."""
    return provider_map.get(native)
