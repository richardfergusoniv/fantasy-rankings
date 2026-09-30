"""Provider registry: name -> provider class."""
from .apisports import APISportsProvider
from .moneyline import MoneyLineProvider
from .oddspapi import OddsPapiProvider
from .oddsapiio import OddsAPIIOProvider
from .parlayapi import ParlayAPIProvider
from .propline import PropLineProvider
from .propzapi import PropzAPIProvider
from .rapidodds import RapidOddsProvider
from .sharpapi import SharpAPIProvider
from .sportsdataio import SportsDataIOProvider
from .sportsgameodds import SportsGameOddsProvider
from .statpick import StatPickProvider
from .theoddsapi import TheOddsAPIProvider

REGISTRY = {
    "propline": PropLineProvider,
    "sharpapi": SharpAPIProvider,
    "sportsgameodds": SportsGameOddsProvider,
    "parlayapi": ParlayAPIProvider,
    "moneyline": MoneyLineProvider,
    "propzapi": PropzAPIProvider,
    "rapidodds": RapidOddsProvider,
    "oddspapi": OddsPapiProvider,
    "theoddsapi": TheOddsAPIProvider,
    "statpick": StatPickProvider,
    "oddsapiio": OddsAPIIOProvider,
    "sportsdataio": SportsDataIOProvider,
    "apisports": APISportsProvider,
}

__all__ = ["REGISTRY"]
