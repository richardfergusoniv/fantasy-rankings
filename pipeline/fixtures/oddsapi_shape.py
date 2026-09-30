"""Fixture: the-odds-api shaped event odds (one book, two markets)."""
FIXTURE = {
    "bookmakers": [
        {
            "key": "draftkings",
            "title": "DraftKings",
            "markets": [
                {
                    "key": "player_pass_yds",
                    "outcomes": [
                        {"description": "Patrick Mahomes", "name": "Over",
                         "point": 285.5, "price": -110},
                        {"description": "Patrick Mahomes", "name": "Under",
                         "point": 285.5, "price": -110},
                        {"description": "Josh Allen", "name": "Over",
                         "point": 260.5, "price": -115},
                        {"description": "Josh Allen", "name": "Under",
                         "point": 260.5, "price": -105},
                    ],
                },
                {
                    "key": "player_anytime_td",
                    "outcomes": [
                        {"description": "Travis Kelce", "name": "Yes",
                         "point": 0.5, "price": -140},
                        {"description": "Travis Kelce", "name": "No",
                         "point": 0.5, "price": 110},
                    ],
                },
                {
                    "key": "some_unknown_market",
                    "outcomes": [
                        {"description": "Nobody", "name": "Over",
                         "point": 1.5, "price": -110},
                    ],
                },
            ],
        }
    ]
}
