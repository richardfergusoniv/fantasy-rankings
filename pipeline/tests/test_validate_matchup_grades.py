"""Matchup-grades validator: dynamic refreshed-user coverage + structure."""
from __future__ import annotations

import importlib.util
from pathlib import Path


def _module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "validate_matchup_grades.py"
    spec = importlib.util.spec_from_file_location("validate_matchup_grades", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def _table() -> dict:
    return {
        f"TEAM{i:02d}": {pos: {"rank": i} for pos in ("QB", "RB", "WR", "TE")}
        for i in range(1, 33)
    }


def _staged(league_ids) -> dict:
    return {
        "through_week": 8,
        "leagues": [
            {"league_id": lid, "league_name": f"League {lid}", "table": _table()}
            for lid in league_ids
        ],
    }


EXPECTED = [str(i) for i in range(8)]


def test_exact_refreshed_coverage_passes():
    module = _module()
    assert module.validate(_staged(EXPECTED), EXPECTED) == []


def test_dynamic_eight_league_build_not_rejected():
    """Regression: the fixed 6-league count rejected the live 8-league build."""
    module = _module()
    assert module.validate(_staged(EXPECTED), EXPECTED) == []
    errors = module.validate(_staged(EXPECTED[:6]), EXPECTED)
    assert any("missing" in e for e in errors)


def test_missing_league_fails():
    module = _module()
    errors = module.validate(_staged(EXPECTED[:-1]), EXPECTED)
    assert any("missing" in e for e in errors)


def test_extra_league_fails():
    module = _module()
    errors = module.validate(_staged(EXPECTED + ["999"]), EXPECTED)
    assert any("outside" in e for e in errors)


def test_structural_checks_still_enforced():
    module = _module()
    staged = _staged(EXPECTED)
    staged["leagues"][0]["table"].pop("TEAM32")
    assert any("32" in e for e in module.validate(staged, EXPECTED))
    staged = _staged(EXPECTED)
    staged["leagues"][0]["table"]["TEAM01"]["QB"]["rank"] = 2
    assert any("permutation" in e for e in module.validate(staged, EXPECTED))


def test_expected_league_ids_dedupes_across_users():
    module = _module()
    by_user = {
        "owner": [{"league_id": "1"}, {"league_id": "2"}],
        "extra": [{"league_id": "2"}, {"league_id": "3"}],
    }
    fetch = lambda url: by_user["owner"] if "/owner/" in url else by_user["extra"]
    assert module.expected_league_ids(["owner", "extra"], fetch) == ["1", "2", "3"]


def test_refreshed_user_ids_from_env():
    module = _module()
    env = {"OWNER_SLEEPER_USER_ID": " 739 ", "REBUILD_EXTRA_SLEEPER_USER_IDS": "862, 990,"}
    assert module.refreshed_user_ids(env) == ["739", "862", "990"]
    assert module.refreshed_user_ids({}) == []
