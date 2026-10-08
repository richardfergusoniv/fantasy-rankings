#!/usr/bin/env python3
"""Skip a scheduled props-daily run when today's pull already succeeded.

The signal is a previous run of this same workflow whose
"Pull providers and build projections" step completed with conclusion
success, and whose start time falls on today's America/Los_Angeles date.
GitHub's default token lists those runs (actions: read). A green run that
only passed an earlier guard has that step skipped, so it does not count.

workflow_dispatch does not consult the check. The script does not read the
projections snapshot, so a pull that reached the app outside this workflow
is not visible here.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta, timezone
from typing import TextIO
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")
PULL_STEP_NAME = "Pull providers and build projections"
WORKFLOW_FILE = "props-daily.yml"
PER_PAGE = 50
MAX_PAGES = 3
CREATED_LOOKBACK = timedelta(hours=6)
REPO_RE = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
TIME_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")

Fetch = Callable[[str, str], dict]


class GuardError(Exception):
    """The Actions API could not answer whether today's pull succeeded."""


def parse_time(value: str) -> datetime | None:
    if not TIME_RE.fullmatch(value or ""):
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def pacific_date(instant: datetime) -> str:
    return instant.astimezone(PACIFIC).date().isoformat()


def pacific_midnight(instant: datetime) -> datetime:
    local = instant.astimezone(PACIFIC)
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


def pull_step_succeeded(jobs: list) -> bool:
    for job in jobs:
        if not isinstance(job, dict):
            continue
        for step in job.get("steps") or []:
            if not isinstance(step, dict):
                continue
            if step.get("name") == PULL_STEP_NAME and step.get("conclusion") == "success":
                return True
    return False


def runs_url(api: str, repo: str, since: datetime, page: int) -> str:
    query = urlencode(
        {
            "status": "success",
            "per_page": str(PER_PAGE),
            "page": str(page),
            "created": ">=" + since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        quote_via=quote,
    )
    return f"{api}/repos/{repo}/actions/workflows/{WORKFLOW_FILE}/runs?{query}"


def jobs_url(api: str, repo: str, run_id: object) -> str:
    return f"{api}/repos/{repo}/actions/runs/{run_id}/jobs?per_page=20"


def run_started(run: dict) -> datetime | None:
    for key in ("run_started_at", "created_at", "updated_at"):
        parsed = parse_time(str(run.get(key) or ""))
        if parsed is not None:
            return parsed
    return None


def counts_as_today(run: dict, today: str, current_run_id: str) -> bool:
    if str(run.get("id")) == current_run_id:
        return False
    if run.get("conclusion") != "success":
        return False
    started = run_started(run)
    return started is not None and pacific_date(started) == today


def find_prior_pull(
    fetch: Fetch,
    api: str,
    repo: str,
    token: str,
    today: str,
    current_run_id: str,
    since: datetime,
) -> dict | None:
    for page in range(1, MAX_PAGES + 1):
        payload = fetch(runs_url(api, repo, since, page), token)
        batch = payload.get("workflow_runs") if isinstance(payload, dict) else None
        if not isinstance(batch, list):
            raise GuardError("GitHub API workflow_runs was not a list.")
        for run in batch:
            if not isinstance(run, dict) or not counts_as_today(run, today, current_run_id):
                continue
            jobs_payload = fetch(jobs_url(api, repo, run.get("id")), token)
            jobs = jobs_payload.get("jobs") if isinstance(jobs_payload, dict) else None
            if not isinstance(jobs, list):
                raise GuardError("GitHub API jobs was not a list.")
            if pull_step_succeeded(jobs):
                return run
        if len(batch) < PER_PAGE:
            break
    return None


def public_run_bits(run: dict) -> tuple[str, str, str, str]:
    run_id = str(run.get("id", ""))
    if not run_id.isdigit():
        run_id = "unknown"
    event = str(run.get("event") or "")
    if not re.fullmatch(r"[A-Za-z0-9_]+", event):
        event = "workflow"
    started = str(run.get("run_started_at") or run.get("created_at") or "")
    if parse_time(started) is None:
        started = ""
    url = str(run.get("html_url") or "")
    if not url.startswith("https://github.com/"):
        url = ""
    return run_id, event, started, url


def skip_message(run: dict, today: str) -> str:
    run_id, event, started, url = public_run_bits(run)
    when = f", started {started}" if started else ""
    text = (
        "Props daily pull skipped: a previous run already completed "
        f'"{PULL_STEP_NAME}" on Pacific date {today} '
        f"({event} run {run_id}{when})."
    )
    if url:
        text = f"{text} {url}"
    return text


def workflow_command(kind: str, message: str) -> str:
    escaped = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return f"::{kind}::{escaped}"


def append_file(path: str | None, text: str) -> None:
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(text)


def fail(env: Mapping[str, str], out: TextIO, message: str) -> int:
    print(message, file=out)
    print(workflow_command("error", message), file=out)
    append_file(env.get("GITHUB_STEP_SUMMARY"), "### Props daily pull guard failed\n\n" + message + "\n")
    return 1


def github_get(url: str, token: str, opener: Callable = urllib.request.urlopen) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "props-daily-guard",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with opener(request, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:180].replace("\n", " ")
        raise GuardError(f"GitHub API HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise GuardError(f"GitHub API request failed: {exc}") from exc
    if not isinstance(payload, dict):
        raise GuardError("GitHub API returned a non-object response.")
    return payload


def run(
    env: Mapping[str, str],
    fetch: Fetch,
    now: datetime | None = None,
    stdout: TextIO | None = None,
) -> int:
    out = stdout or sys.stdout
    event = env.get("GITHUB_EVENT_NAME") or ""
    if event != "schedule":
        label = event or "unspecified"
        print(f"Proceeding: event is {label}, so the already-pulled check is not used.", file=out)
        append_file(env.get("GITHUB_OUTPUT"), "go=true\n")
        return 0

    token = env.get("GITHUB_TOKEN") or ""
    repo = env.get("GITHUB_REPOSITORY") or ""
    if not token or not REPO_RE.fullmatch(repo):
        return fail(env, out, "Props daily guard needs GITHUB_TOKEN and GITHUB_REPOSITORY.")

    api = (env.get("GITHUB_API_URL") or "https://api.github.com").rstrip("/")
    current = str(env.get("GITHUB_RUN_ID") or "")
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    today = pacific_date(moment)
    since = pacific_midnight(moment) - CREATED_LOOKBACK
    try:
        prior = find_prior_pull(fetch, api, repo, token, today, current, since)
    except Exception as exc:
        return fail(env, out, f"Props daily guard could not check today's runs: {exc}")

    if prior is None:
        print(f"Proceeding: no completed props pull for Pacific date {today}.", file=out)
        append_file(env.get("GITHUB_OUTPUT"), "go=true\n")
        return 0

    message = skip_message(prior, today)
    print(message, file=out)
    print(workflow_command("notice", message), file=out)
    append_file(env.get("GITHUB_STEP_SUMMARY"), "### Props daily pull skipped\n\n" + message + "\n")
    append_file(env.get("GITHUB_OUTPUT"), "go=false\n")
    return 0


def main() -> int:
    return run(os.environ, github_get)


if __name__ == "__main__":
    sys.exit(main())
