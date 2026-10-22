"""Partial Vegas boards stay usable when they still have skill players."""
from __future__ import annotations

import importlib.util
from pathlib import Path


def _module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "validate_projections.py"
    spec = importlib.util.spec_from_file_location("validate_projections", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_non_kicker_count_keeps_partial_vegas_boards():
    module = _module()
    projections = [
        {"player": "Tyler Warren", "position": "TE"},
        {"player": "Only K", "position": "K"},
        {"player": "Quinshon Judkins", "position": "RB"},
    ]
    assert module.non_kicker_count(projections) == 2
    assert module.non_kicker_count([{"player": "K1", "position": "K"}]) == 0
    assert module.non_kicker_count([]) == 0


def test_partial_vegas_keep_decision_matches_workflow_guard():
    """Mirror the props-daily keep_vegas gate: >=1 non-K keeps the board."""
    module = _module()
    thin_with_skill = [{"player": "A", "position": "WR"}, {"player": "K", "position": "K"}]
    kickers_only = [{"player": "K1", "position": "K"}, {"player": "K2", "position": "K"}]
    assert module.non_kicker_count(thin_with_skill) >= 1
    assert module.non_kicker_count(kickers_only) < 1
