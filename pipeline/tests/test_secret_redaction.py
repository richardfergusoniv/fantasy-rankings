"""Tests: provider failures must never leak API keys (audit finding #7),
and cmd_pull must report partial/failed outcomes (no network)."""
import json

import pytest
import requests

from props_aggregator.base import ProviderError, _parse_retry_after
from props_aggregator.providers.theoddsapi import TheOddsAPIProvider

SENTINEL = "AUDIT_SENTINEL"


def _failing_provider(monkeypatch):
    """Query-key provider whose session.get raises like a real connection
    failure: requests embeds the full prepared URL in the exception text."""
    provider = TheOddsAPIProvider(api_key=SENTINEL)
    url = f"https://api.the-odds-api.com/v4/x?apiKey={SENTINEL}&markets=x"

    def boom(*_a, **_k):
        raise requests.ConnectionError(
            f"HTTPSConnectionPool(host='api.the-odds-api.com'): "
            f"Max retries exceeded with url: {url}")

    monkeypatch.setattr(provider.session, "get", boom)
    return provider


def test_provider_error_contains_no_api_key(monkeypatch):
    provider = _failing_provider(monkeypatch)
    with pytest.raises(ProviderError) as excinfo:
        provider._get("https://api.the-odds-api.com/v4/x",
                      params={"apiKey": SENTINEL}, retries=0)
    err = excinfo.value
    blob = str(err) + repr(err) + str(provider.last_error)
    assert SENTINEL not in blob
    assert "***" in str(err)
    # nothing unsanitized left on the exception chain
    assert err.__context__ is None
    assert err.__cause__ is None


def test_pull_artifacts_contain_no_api_key(monkeypatch, tmp_path, capsys):
    from props_aggregator import cli

    provider = _failing_provider(monkeypatch)
    monkeypatch.setattr(cli, "_pull_provider", None)  # replaced below

    def fake_pull(name, week, season):
        try:
            provider.fetch_props(week=week, season=season)
        except ProviderError as exc:
            return [], str(exc)
        return [], "unreachable"

    monkeypatch.setattr(cli, "_pull_provider", fake_pull)
    monkeypatch.setitem(cli.REGISTRY, "propline", type(provider))

    class Args:
        all = False
        provider = ["propline"]
        week = 4
        season = 2026
        data_dir = str(tmp_path)
        min_providers = 1

    rc = cli.cmd_pull(Args())
    out = capsys.readouterr().out
    payload = json.loads((tmp_path / "props_2026_w4.json").read_text())
    blob = out + json.dumps(payload)
    assert SENTINEL not in blob
    assert payload["outcome"] == "failed"
    assert rc == 1


def test_pull_partial_outcome_exit_zero(monkeypatch, tmp_path):
    from props_aggregator import cli

    calls = {"n": 0}

    def fake_pull(name, week, season):
        calls["n"] += 1
        if name == "propline":
            return [], "network error: redacted"
        from props_aggregator.schema import PropRecord
        return [PropRecord(provider=name, book="dk", player="Patrick Mahomes",
                           stat="pass_yards", line=285.5, over_odds=-110,
                           under_odds=-110, week=week, season=season)], None

    monkeypatch.setattr(cli, "_pull_provider", fake_pull)

    class Args:
        all = False
        provider = ["propline", "statpick"]
        week = 4
        season = 2026
        data_dir = str(tmp_path)
        min_providers = 1

    rc = cli.cmd_pull(Args())
    payload = json.loads((tmp_path / "props_2026_w4.json").read_text())
    assert payload["outcome"] == "partial"
    assert rc == 0


def test_pull_min_providers_threshold(monkeypatch, tmp_path):
    from props_aggregator import cli
    monkeypatch.setattr(cli, "_pull_provider", lambda *a: ([], None))

    class Args:
        all = False
        provider = ["statpick"]
        week = 4
        season = 2026
        data_dir = str(tmp_path)
        min_providers = 2

    assert cli.cmd_pull(Args()) == 1
    payload = json.loads((tmp_path / "props_2026_w4.json").read_text())
    assert payload["outcome"] == "failed"


def test_retry_after_parsing():
    assert _parse_retry_after(None) == 5.0
    assert _parse_retry_after("2") == 2.0
    assert _parse_retry_after("99999") == 60.0
    assert _parse_retry_after("garbage") == 5.0
    assert _parse_retry_after("-5") == 0.0
    assert _parse_retry_after("nan") == 5.0
    assert _parse_retry_after("inf") == 5.0
    # HTTP-date form is honored (capped) rather than falling back to default
    from email.utils import format_datetime
    from datetime import datetime, timedelta, timezone
    future = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=30))
    assert _parse_retry_after(future) <= 30.0
    assert _parse_retry_after(future) > 20.0
    past = format_datetime(datetime.now(timezone.utc) - timedelta(seconds=30))
    assert _parse_retry_after(past) == 0.0


def test_non_json_error_drops_cause_chain(monkeypatch):
    """A response body echoing the key must not survive via __cause__/.doc."""
    provider = TheOddsAPIProvider(api_key=SENTINEL)
    body = f'not-json?apiKey={SENTINEL}&more=1'

    class Resp:
        ok = True
        status_code = 200
        text = body

        def json(self):
            import json as _json
            return _json.loads(body)  # raises with .doc = body

    monkeypatch.setattr(provider.session, "get", lambda *a, **k: Resp())
    with pytest.raises(ProviderError) as excinfo:
        provider._get("https://x.test/odds", retries=0)
    err = excinfo.value
    assert SENTINEL not in str(err)
    assert err.__cause__ is None
    assert err.__context__ is None


def _write_old_week(tmp_path):
    old = tmp_path / "props_2026_w3.json"
    old.write_text("{}")
    (tmp_path / "consensus_2026_w3.json").write_text("{}")
    return old


@pytest.mark.parametrize("min_providers", [0, 1])
def test_empty_pull_is_failed_and_keeps_history(monkeypatch, tmp_path, min_providers):
    """Zero records with no error is not a successful pull: it must not count
    toward --min-providers or trigger pruning of earlier weeks."""
    from props_aggregator import cli
    monkeypatch.setattr(cli, "_pull_provider", lambda *a: ([], None))
    old = _write_old_week(tmp_path)

    class Args:
        all = False
        provider = ["statpick", "propline"]
        week = 4
        season = 2026
        data_dir = str(tmp_path)

    Args.min_providers = min_providers
    rc = cli.cmd_pull(Args())
    payload = json.loads((tmp_path / "props_2026_w4.json").read_text())
    if min_providers == 1:
        assert payload["outcome"] == "failed"
        assert rc == 1
    assert old.exists()
    assert (tmp_path / "consensus_2026_w3.json").exists()
