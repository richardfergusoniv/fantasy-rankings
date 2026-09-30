"""CLI: pull props, build consensus, report coverage, validate config.

Usage:
  python -m props_aggregator.cli pull --provider statpick --week 4
  python -m props_aggregator.cli pull --all --week 4 --season 2026
  python -m props_aggregator.cli coverage --week 4 --season 2026
  python -m props_aggregator.cli --check-config
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from .base import ProviderError
from .consensus import build_consensus
from .coverage import coverage_report
from .providers import REGISTRY
from .schema import utcnow_iso

try:  # optional: load keys from a gitignored .env next to the project
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def _parse_providers(args) -> list[str]:
    if args.all:
        return sorted(REGISTRY)
    names: list[str] = []
    for chunk in args.provider or []:
        names.extend(p.strip() for p in chunk.split(",") if p.strip())
    unknown = [n for n in names if n not in REGISTRY]
    if unknown:
        print(f"unknown providers: {', '.join(unknown)}", file=sys.stderr)
        print(f"known: {', '.join(sorted(REGISTRY))}", file=sys.stderr)
        sys.exit(2)
    return names


def _pull_provider(name: str, week: int, season: int):
    """Returns (records, error). Never raises."""
    cls = REGISTRY[name]
    try:
        provider = cls()
    except Exception as exc:  # pragma: no cover - defensive
        return [], f"init failed: {exc}"
    problems = provider.check_config()
    if problems:
        return [], "; ".join(problems)
    try:
        records = provider.fetch_props(week=week, season=season)
    except ProviderError as exc:
        return [], str(exc)
    except NotImplementedError as exc:
        return [], str(exc) or "not implemented"
    except Exception as exc:  # pragma: no cover - defensive
        return [], f"unexpected error: {exc}"
    bad = [r for r in records if r.validate()]
    if bad:
        print(f"  [{name}] WARNING: {len(bad)} invalid records dropped", file=sys.stderr)
    records = [r for r in records if not r.validate()]
    return records, None


def cmd_pull(args) -> int:
    names = _parse_providers(args)
    os.makedirs(args.data_dir, exist_ok=True)
    all_records: list = []
    per_provider: dict = {}
    for name in names:
        print(f"[{name}] pulling week {args.week} season {args.season}...")
        records, error = _pull_provider(name, args.week, args.season)
        if error:
            print(f"[{name}] skipped: {error}")
            per_provider[name] = {"records": [], "error": error}
        else:
            print(f"[{name}] {len(records)} records")
            per_provider[name] = {"records": [r.to_dict() for r in records], "error": None}
            all_records.extend(records)
    props_path = os.path.join(args.data_dir, f"props_{args.season}_w{args.week}.json")
    with open(props_path, "w") as f:
        json.dump({
            "season": args.season, "week": args.week,
            "fetched_at": utcnow_iso(), "providers": per_provider,
            "records": [r.to_dict() for r in all_records],
        }, f, indent=1)
    consensus = build_consensus(all_records)
    consensus_path = os.path.join(args.data_dir, f"consensus_{args.season}_w{args.week}.json")
    with open(consensus_path, "w") as f:
        json.dump({"season": args.season, "week": args.week,
                   "built_at": utcnow_iso(), "consensus": consensus}, f, indent=1)
    print(f"wrote {props_path} ({len(all_records)} records)")
    print(f"wrote {consensus_path} ({len(consensus)} consensus rows)")
    return 0


def cmd_coverage(args) -> int:
    path = os.path.join(args.data_dir, f"props_{args.season}_w{args.week}.json")
    if not os.path.exists(path):
        print(f"no data file {path}; run pull first", file=sys.stderr)
        return 1
    from .schema import PropRecord
    with open(path) as f:
        payload = json.load(f)
    by_provider: dict[str, list] = {}
    for name, block in payload.get("providers", {}).items():
        by_provider[name] = [PropRecord.from_dict(d) for d in block.get("records", [])]
    report = coverage_report(by_provider)
    print(f"coverage for season {args.season} week {args.week}:")
    for name in sorted(report):
        cov = report[name]
        err = payload["providers"][name].get("error")
        status = f"ERROR: {err}" if err else "ok"
        print(f"\n{name} [{status}]")
        print(f"  records={cov['records']} players={cov['players']} "
              f"books={cov['book_count']} markets={cov['market_count']}")
        if cov["books"]:
            print(f"  books: {', '.join(cov['books'])}")
        if cov["markets"]:
            print(f"  markets: {', '.join(cov['markets'])}")
    return 0


def cmd_project(args) -> int:
    from pathlib import Path
    from .projections import project_week
    out = project_week(args.week, args.season, Path(args.data_dir))
    import json as _json
    payload = _json.loads(out.read_text())
    n = len(payload["projections"])
    with_pos = sum(1 for p in payload["projections"] if p["position"])
    print(f"wrote {out} ({n} players, {with_pos} with position)")
    return 0


def cmd_check_config(_args) -> int:
    print("provider setup check (no network calls):")
    problems = 0
    for name in sorted(REGISTRY):
        provider = REGISTRY[name]()
        issues = provider.check_config()
        key_state = "keyless" if not provider.requires_key else (
            "key set" if provider.api_key else "KEY MISSING")
        if issues:
            problems += 1
            print(f"  {name:15} {key_state:10} ISSUES: {'; '.join(issues)}")
        else:
            print(f"  {name:15} {key_state:10} ok - {provider.status_note}")
    print(f"\n{problems} provider(s) need attention")
    return 0 if problems == 0 else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="props-aggregator",
                                     description="NFL player-props aggregator")
    parser.add_argument("--check-config", action="store_true",
                        help="validate setup without making keyed calls")
    parser.add_argument("--data-dir", default="data",
                        help="where props/consensus JSON files are written")
    sub = parser.add_subparsers(dest="command")

    pull = sub.add_parser("pull", help="pull props and build consensus")
    pull.add_argument("--provider", action="append",
                      help="provider name (repeatable, comma-separated ok)")
    pull.add_argument("--all", action="store_true", help="pull all providers")
    pull.add_argument("--week", type=int, required=True)
    pull.add_argument("--season", type=int, default=2026)

    cov = sub.add_parser("coverage", help="report markets/players/books by provider")
    cov.add_argument("--week", type=int, required=True)
    cov.add_argument("--season", type=int, default=2026)

    proj = sub.add_parser("project", help="build Vegas fantasy projections from consensus")
    proj.add_argument("--week", type=int, required=True)
    proj.add_argument("--season", type=int, default=2026)

    args = parser.parse_args(argv)
    if args.check_config and not args.command:
        return cmd_check_config(args)
    if args.command == "pull":
        if args.check_config:
            print("--check-config with pull: validating only, no network calls")
            return cmd_check_config(args)
        if not args.all and not args.provider:
            print("specify --provider X or --all", file=sys.stderr)
            return 2
        return cmd_pull(args)
    if args.command == "coverage":
        return cmd_coverage(args)
    if args.command == "project":
        return cmd_project(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
