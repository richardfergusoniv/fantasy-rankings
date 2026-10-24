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
        return [], None  # empty success still counts as reachable

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
