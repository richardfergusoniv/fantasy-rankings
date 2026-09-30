"""Tests: registry completeness and safe failure modes (no network)."""
import os

import pytest

from props_aggregator.base import ProviderError
from props_aggregator.providers import REGISTRY

EXPECTED = {"propline", "sharpapi", "sportsgameodds", "parlayapi", "moneyline",
            "propzapi", "rapidodds", "oddspapi", "theoddsapi", "statpick",
            "oddsapiio", "sportsdataio", "apisports"}


def test_registry_has_all_providers():
    assert set(REGISTRY) == EXPECTED


def test_missing_key_reported_not_called():
    for name, cls in REGISTRY.items():
        old = dict(os.environ)
        try:
            for k in list(os.environ):
                if k.endswith("_API_KEY"):
                    del os.environ[k]
            if cls.env_var is None:
                continue  # keyless
            provider = cls()
            problems = provider.check_config()
            assert problems, name
        finally:
            os.environ.clear()
            os.environ.update(old)


def test_stubs_raise_clear_errors():
    from props_aggregator.providers.sportsdataio import SportsDataIOProvider
    from props_aggregator.providers.apisports import APISportsProvider
    for cls in (SportsDataIOProvider, APISportsProvider):
        with pytest.raises(ProviderError, match="stub"):
            cls(api_key="dummy").fetch_props(week=4, season=2026)


def test_propzapi_inactive():
    from props_aggregator.providers.propzapi import PropzAPIProvider
    p = PropzAPIProvider()
    assert not p.active
    assert p.check_config()
