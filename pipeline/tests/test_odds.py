"""Tests: odds conversions."""
from props_aggregator.odds import (american_to_decimal, american_to_prob,
                                   decimal_to_american)


def test_decimal_to_american():
    assert decimal_to_american(1.91) == -110
    assert decimal_to_american(2.5) == 150
    assert decimal_to_american(2.0) == 100
    assert decimal_to_american(None) is None
    assert decimal_to_american(1.0) is None


def test_american_to_decimal():
    assert abs(american_to_decimal(-110) - 1.909) < 0.001
    assert american_to_decimal(150) == 2.5
    assert american_to_decimal(None) is None


def test_american_to_prob():
    assert abs(american_to_prob(-110) - 0.5238) < 0.001
