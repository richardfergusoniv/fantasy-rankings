"""The props workflow reads the stored snapshot with the existing cron secret."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch


def _module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "verify_dashboard.py"
    spec = importlib.util.spec_from_file_location("verify_dashboard", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_stored_snapshot_request_sends_the_cron_secret_and_unwraps_dashboard():
    module = _module()
    payload = {"ok": True, "dashboard": {"week": 5, "rankings": []}}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(payload).encode()

    with patch.object(module.urllib.request, "urlopen", return_value=FakeResponse()) as urlopen:
        dashboard = module.stored_snapshot_request(
            "https://example.test/api/cron/jobs?job=read-dashboard-snapshot",
            "secret",
        )

    request = urlopen.call_args.args[0]
    assert request.full_url.endswith("job=read-dashboard-snapshot")
    assert request.get_header("Authorization") == "Bearer secret"
    assert dashboard == payload["dashboard"]


def test_stored_snapshot_request_rejects_a_body_without_a_dashboard():
    module = _module()

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"ok": true}'

    with patch.object(module.urllib.request, "urlopen", return_value=FakeResponse()):
        try:
            module.stored_snapshot_request("https://example.test/snapshot", "secret")
        except RuntimeError as error:
            assert "no dashboard" in str(error)
        else:
            raise AssertionError("expected a missing dashboard to fail")


def test_td_probability_error_skips_when_anytime_td_is_missing():
    module = _module()
    player = {"player": "Backup QB", "position": "QB", "td_probability": None}
    assert module.td_probability_error(player, {"rush_td": None}) is None
    assert module.td_probability_error(player, {"rush_td": 0.12}) is None


def test_td_probability_error_flags_mismatched_values():
    module = _module()
    player = {"player": "Star WR", "position": "WR", "td_probability": 0.4}
    assert module.td_probability_error(player, {"rec_td": 0.4}) is None
    error = module.td_probability_error(player, {"rec_td": 0.1})
    assert error is not None and error.startswith("TD Star WR rec_td:")


def test_td_probability_error_uses_rush_td_for_rb():
    # RBs map anytime TD to rush_td (same as the app's adaptVegasStatsForScorer).
    module = _module()
    rb = {"player": "Workhorse RB", "position": "RB", "td_probability": 0.35}
    assert module.td_probability_error(rb, {"rush_td": 0.35, "rec_td": 0.1}) is None
    error = module.td_probability_error(rb, {"rush_td": None, "rec_td": 0.35})
    assert error is not None and "rush_td" in error


def test_td_probability_error_uses_rec_td_for_wr_and_te():
    module = _module()
    wr = {"player": "X Receiver", "position": "WR", "td_probability": 0.22}
    assert module.td_probability_error(wr, {"rec_td": 0.22, "rush_td": 0.05}) is None
    te_error = module.td_probability_error(
        {"player": "Tight End", "position": "TE", "td_probability": 0.18},
        {"rec_td": None, "rush_td": 0.18},
    )
    assert te_error is not None and "rec_td" in te_error


def test_td_probability_error_uses_rush_td_for_qb():
    module = _module()
    qb = {"player": "Scrambling QB", "position": "QB", "td_probability": 0.2}
    assert module.td_probability_error(qb, {"rush_td": 0.2}) is None
    error = module.td_probability_error(qb, {"rush_td": 0.05})
    assert error is not None and error.startswith("TD Scrambling QB rush_td:")


def test_anytime_td_score_key_matches_app_contract():
    module = _module()
    assert module.anytime_td_score_key("WR") == "rec_td"
    assert module.anytime_td_score_key("TE") == "rec_td"
    assert module.anytime_td_score_key("RB") == "rush_td"
    assert module.anytime_td_score_key("QB") == "rush_td"
    assert module.anytime_td_score_key("UNK") == "rush_td"


def test_persist_diagnostics_writes_full_error_list():
    import tempfile

    module = _module()
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "verify_dashboard_errors.json"
        errors = [f"err-{i}" for i in range(40)]
        warnings = ["warn-a"]
        written = module.persist_diagnostics(
            path,
            errors=errors,
            warnings=warnings,
            week=9,
            as_of="2026-11-04T12:00:00.000Z",
        )
        assert written == path
        payload = json.loads(path.read_text())
        assert payload["ok"] is False
        assert payload["errorCount"] == 40
        assert payload["warningCount"] == 1
        assert payload["errors"] == errors
        assert payload["warnings"] == warnings
        assert payload["week"] == 9


def test_diagnostics_path_honors_env():
    import os
    import tempfile

    module = _module()
    with tempfile.TemporaryDirectory() as tmp:
        staged = Path(tmp) / "staged_for_push.json"
        override = Path(tmp) / "custom" / "errors.json"
        previous = os.environ.get("VERIFY_ERRORS_PATH")
        try:
            os.environ["VERIFY_ERRORS_PATH"] = str(override)
            assert module.diagnostics_path(staged) == override
            del os.environ["VERIFY_ERRORS_PATH"]
            assert module.diagnostics_path(staged) == Path(tmp) / "verify_dashboard_errors.json"
        finally:
            if previous is None:
                os.environ.pop("VERIFY_ERRORS_PATH", None)
            else:
                os.environ["VERIFY_ERRORS_PATH"] = previous
