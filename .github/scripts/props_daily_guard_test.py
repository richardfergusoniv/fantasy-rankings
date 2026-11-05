#!/usr/bin/env python3
"""Dry run of the props-daily guard with mocked dates and Actions responses.

Run from the repo root:

    python3 .github/scripts/props_daily_guard_test.py
"""

from __future__ import annotations

import importlib.util
import io
import tempfile
import unittest
import urllib.error
from datetime import datetime, time, timezone
from email.message import Message
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SCRIPT = Path(__file__).with_name("props_daily_guard.py")
SPEC = importlib.util.spec_from_file_location("props_daily_guard", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load props_daily_guard")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

REPO = "richardfergusoniv/fantasy-rankings"
# 17:37 UTC on Oct 7 is 10:37 AM Pacific (PDT). Run 37660524386 started then
# and finished green while the pull step was skipped.
LATE_MORNING = datetime(2026, 10, 7, 17, 37, 37, tzinfo=timezone.utc)
# 15:30 UTC is 8:30 AM PDT, before the 9:00 AM cutoff. 16:00 UTC is 9:00 AM.
BEFORE_CUTOFF = datetime(2026, 10, 7, 15, 30, tzinfo=timezone.utc)
AT_CUTOFF = datetime(2026, 10, 7, 16, 0, tzinfo=timezone.utc)
SKIPPED_RUN_ID = 37660524386
CRON_SECRET = "cron-secret-value"


def run_record(
    run_id: int,
    started: str,
    event: str = "schedule",
    conclusion: str = "success",
) -> dict:
    return {
        "id": run_id,
        "event": event,
        "conclusion": conclusion,
        "run_started_at": started,
        "created_at": started,
        "html_url": f"https://github.com/{REPO}/actions/runs/{run_id}",
    }


def jobs(verify_conclusion: str, pull_conclusion: str | None = None) -> dict:
    pull = pull_conclusion if pull_conclusion is not None else verify_conclusion
    return {
        "jobs": [
            {
                "name": "pull",
                "conclusion": "success" if verify_conclusion == "success" else "failure",
                "steps": [
                    {"name": "Skip if today's pull already succeeded", "conclusion": "success"},
                    {"name": "Pull providers and build projections", "conclusion": pull},
                    {"name": "Push projections to Vercel", "conclusion": pull},
                    {"name": guard.VERIFY_STEP_NAME, "conclusion": verify_conclusion},
                ],
            }
        ]
    }


class Fetch:
    def __init__(self, pages: dict[int, list], job_map: dict[int, dict]):
        self.pages = pages
        self.job_map = job_map
        self.urls: list[str] = []
        self.tokens: list[str] = []

    def __call__(self, url: str, token: str) -> dict:
        self.urls.append(url)
        self.tokens.append(token)
        path = urlparse(url).path
        if path.endswith("/jobs"):
            run_id = int(path.split("/runs/")[1].split("/")[0])
            return self.job_map[run_id]
        page = int(parse_qs(urlparse(url).query)["page"][0])
        return {"workflow_runs": self.pages.get(page, [])}


class GuardTests(unittest.TestCase):
    def execute(self, env: dict, fetch: Fetch, now: datetime = LATE_MORNING):
        output = tempfile.NamedTemporaryFile(delete=False)
        summary = tempfile.NamedTemporaryFile(delete=False)
        output.close()
        summary.close()

        env = {
            "GITHUB_REPOSITORY": REPO,
            "GITHUB_API_URL": "https://api.github.com",
            "GITHUB_RUN_ID": "999",
            "GITHUB_TOKEN": "secret-token",
            "GITHUB_OUTPUT": output.name,
            "GITHUB_STEP_SUMMARY": summary.name,
            "APP_BASE_URL": "https://fantasy-rankings-ten.vercel.app",
            "CRON_SECRET": CRON_SECRET,
            **env,
        }
        stdout = io.StringIO()
        code = guard.run(
            env,
            fetch,
            now=now,
            stdout=stdout,
        )
        text = stdout.getvalue()
        summary_text = Path(summary.name).read_text(encoding="utf-8")
        self.assertNotIn(CRON_SECRET, text)
        self.assertNotIn(CRON_SECRET, summary_text)
        return {
            "code": code,
            "stdout": text,
            "output": Path(output.name).read_text(encoding="utf-8"),
            "summary": summary_text,
            "fetch": fetch,
        }

    def test_pacific_date_follows_daylight_saving(self):
        # October is PDT (UTC-7): 06:30Z is still the previous evening.
        self.assertEqual(guard.pacific_date(datetime(2026, 10, 8, 6, 30, tzinfo=timezone.utc)), "2026-10-07")
        self.assertEqual(guard.pacific_date(datetime(2026, 10, 8, 7, 30, tzinfo=timezone.utc)), "2026-10-08")
        # December is PST (UTC-8).
        self.assertEqual(guard.pacific_date(datetime(2026, 12, 8, 7, 30, tzinfo=timezone.utc)), "2026-12-07")
        self.assertEqual(guard.pacific_date(datetime(2026, 12, 8, 8, 30, tzinfo=timezone.utc)), "2026-12-08")

    def test_before_cutoff_runs_when_only_green_skips_exist(self):
        fetch = Fetch(
            pages={1: [run_record(SKIPPED_RUN_ID, "2026-10-07T15:20:00Z")]},
            job_map={SKIPPED_RUN_ID: jobs("skipped")},
        )
        result = self.execute({"GITHUB_EVENT_NAME": "schedule"}, fetch, now=BEFORE_CUTOFF)
        self.assertEqual(result["code"], 0)
        self.assertEqual(result["output"], "go=true\n")
        self.assertIn("Pacific date 2026-10-07", result["stdout"])
        self.assertNotIn("::notice::", result["stdout"])
        self.assertNotIn("::warning::", result["stdout"])
        self.assertEqual(result["summary"], "")
        self.assertTrue(any("/jobs?" in url for url in fetch.urls))

    def test_late_scheduled_run_warns_when_today_is_missing(self):
        fetch = Fetch(
            pages={1: [run_record(SKIPPED_RUN_ID, "2026-10-07T17:37:37Z")]},
            job_map={SKIPPED_RUN_ID: jobs("skipped")},
        )
        result = self.execute({"GITHUB_EVENT_NAME": "schedule"}, fetch, now=LATE_MORNING)
        self.assertEqual(result["code"], 0)
        self.assertEqual(result["output"], "go=false\n")
        self.assertIn("::warning::", result["stdout"])
        self.assertIn("today's validated pull is missing", result["stdout"])
        self.assertIn("workflow_dispatch", result["stdout"])
        self.assertIn(guard.cutoff_label(), result["summary"])
        self.assertNotIn(str(SKIPPED_RUN_ID), result["stdout"])
        self.assertNotIn("::notice::", result["stdout"])

    def test_schedule_skips_after_verify_step_succeeded_today(self):
        pull_id = 42
        fetch = Fetch(
            pages={
                1: [
                    run_record(SKIPPED_RUN_ID, "2026-10-07T17:37:37Z"),
                    run_record(pull_id, "2026-10-07T16:00:00Z", event="workflow_dispatch"),
                ]
            },
            job_map={
                SKIPPED_RUN_ID: jobs("skipped"),
                pull_id: jobs("success"),
            },
        )
        result = self.execute({"GITHUB_EVENT_NAME": "schedule"}, fetch)
        self.assertEqual(result["code"], 0)
        self.assertEqual(result["output"], "go=false\n")
        self.assertIn("::notice::", result["stdout"])
        self.assertIn("Pacific date 2026-10-07", result["stdout"])
        self.assertIn("workflow_dispatch run 42", result["stdout"])
        self.assertIn(guard.VERIFY_STEP_NAME, result["summary"])
        self.assertIn("### Props daily pull skipped", result["summary"])
        self.assertIn(f"https://github.com/{REPO}/actions/runs/42", result["summary"])
        self.assertNotIn("secret-token", result["stdout"])
        self.assertNotIn("secret-token", result["summary"])

    def test_pull_success_without_verify_does_not_skip(self):
        # A run that pulled but never validated must not block a retry.
        pull_id = 42
        fetch = Fetch(
            pages={1: [run_record(pull_id, "2026-10-07T15:00:00Z")]},
            job_map={pull_id: jobs("skipped", pull_conclusion="success")},
        )
        result = self.execute({"GITHUB_EVENT_NAME": "schedule"}, fetch, now=BEFORE_CUTOFF)
        self.assertEqual(result["output"], "go=true\n")
        self.assertNotIn("::notice::", result["stdout"])
        self.assertTrue(any("/jobs?" in url for url in fetch.urls))

    def test_previous_pacific_date_does_not_count(self):
        yesterday = 7
        fetch = Fetch(
            pages={1: [run_record(yesterday, "2026-10-06T18:00:00Z")]},
            job_map={yesterday: jobs("success")},
        )
        result = self.execute({"GITHUB_EVENT_NAME": "schedule"}, fetch, now=BEFORE_CUTOFF)
        self.assertEqual(result["output"], "go=true\n")
        self.assertFalse(any("/jobs?" in url for url in fetch.urls))

    def test_current_run_and_failed_conclusion_do_not_count(self):
        fetch = Fetch(
            pages={
                1: [
                    run_record(999, "2026-10-07T17:00:00Z"),
                    run_record(8, "2026-10-07T16:30:00Z", conclusion="failure"),
                ]
            },
            job_map={},
        )
        result = self.execute({"GITHUB_EVENT_NAME": "schedule", "GITHUB_RUN_ID": "999"}, fetch, now=BEFORE_CUTOFF)
        self.assertEqual(result["output"], "go=true\n")
        self.assertFalse(any("/jobs?" in url for url in fetch.urls))

    def test_dispatch_always_runs_without_calling_the_api(self):
        fetch = Fetch(pages={1: [run_record(42, "2026-10-07T16:00:00Z")]}, job_map={42: jobs("success")})
        result = self.execute({"GITHUB_EVENT_NAME": "workflow_dispatch"}, fetch, now=LATE_MORNING)
        self.assertEqual(result["code"], 0)
        self.assertEqual(result["output"], "go=true\n")
        self.assertIn("workflow_dispatch", result["stdout"])
        self.assertEqual(fetch.urls, [])
        self.assertEqual(result["summary"], "")

    def test_api_error_fails_instead_of_a_green_skip(self):
        def fetch(url: str, token: str) -> dict:
            raise urllib.error.URLError("timed out")

        result = self.execute({"GITHUB_EVENT_NAME": "schedule"}, fetch, now=BEFORE_CUTOFF)
        self.assertEqual(result["code"], 1)
        self.assertEqual(result["output"], "")
        self.assertIn("::error::", result["stdout"])
        self.assertIn("Actions run check failed", result["summary"])
        self.assertNotIn("go=false", result["output"])
        self.assertNotIn("secret-token", result["stdout"])

    def test_missing_token_fails(self):
        fetch = Fetch(pages={}, job_map={})
        result = self.execute({"GITHUB_EVENT_NAME": "schedule", "GITHUB_TOKEN": ""}, fetch, now=BEFORE_CUTOFF)
        self.assertEqual(result["code"], 1)
        self.assertEqual(fetch.urls, [])
        self.assertIn("GITHUB_TOKEN", result["summary"])

    def test_pages_through_lookback_until_today_pull(self):
        original = guard.PER_PAGE
        guard.PER_PAGE = 2
        try:
            older = [run_record(1, "2026-10-06T18:00:00Z"), run_record(2, "2026-10-06T17:00:00Z")]
            today = [run_record(3, "2026-10-07T15:00:00Z")]
            fetch = Fetch(pages={1: older, 2: today}, job_map={3: jobs("success")})
            result = self.execute({"GITHUB_EVENT_NAME": "schedule"}, fetch)
        finally:
            guard.PER_PAGE = original
        self.assertEqual(result["output"], "go=false\n")
        self.assertTrue(any("page=2" in url for url in fetch.urls))
        self.assertTrue(any("/runs/3/jobs" in url for url in fetch.urls))
        self.assertFalse(any("/runs/1/jobs" in url for url in fetch.urls))

    def test_runs_url_asks_for_successful_runs_of_this_workflow(self):
        since = datetime(2026, 10, 8, 1, 0, tzinfo=timezone.utc)
        url = guard.runs_url("https://api.github.com", REPO, since, 1)
        self.assertIn("/repos/richardfergusoniv/fantasy-rankings/actions/workflows/props-daily.yml/runs?", url)
        self.assertIn("status=success", url)
        self.assertIn("created=%3E%3D2026-10-08T01%3A00%3A00Z", url)

    def test_cutoff_constant_blocks_scheduled_runs_from_nine_am(self):
        self.assertEqual(guard.SCHEDULED_PULL_CUTOFF, time(9, 0))
        three_am = datetime(2026, 10, 7, 10, 0, tzinfo=timezone.utc)
        eight_fifty_nine = datetime(2026, 10, 7, 15, 59, tzinfo=timezone.utc)
        early = self.execute({"GITHUB_EVENT_NAME": "schedule"}, Fetch(pages={1: []}, job_map={}), now=three_am)
        just_before = self.execute(
            {"GITHUB_EVENT_NAME": "schedule"},
            Fetch(pages={1: []}, job_map={}),
            now=eight_fifty_nine,
        )
        at_cutoff = self.execute({"GITHUB_EVENT_NAME": "schedule"}, Fetch(pages={1: []}, job_map={}), now=AT_CUTOFF)
        self.assertEqual(early["output"], "go=true\n")
        self.assertEqual(just_before["output"], "go=true\n")
        self.assertEqual(at_cutoff["output"], "go=false\n")
        self.assertIn("::warning::", at_cutoff["stdout"])
        self.assertIn("today's validated pull is missing", at_cutoff["summary"])
        self.assertIn("manual workflow_dispatch", at_cutoff["summary"])

    def test_github_get_error_omits_the_token(self):
        def opener(request, timeout=30):
            self.assertEqual(timeout, 30)
            self.assertEqual(request.get_header("Authorization"), "Bearer secret-token")
            raise urllib.error.HTTPError(
                request.full_url,
                503,
                "unavailable",
                Message(),
                io.BytesIO(b"unavailable"),
            )

        with self.assertRaises(guard.GuardError) as caught:
            guard.github_get("https://api.github.com/repos/o/r/actions/workflows/props-daily.yml/runs", "secret-token", opener)
        self.assertIn("HTTP 503", str(caught.exception))
        self.assertNotIn("secret-token", str(caught.exception))

    def test_notice_escapes_workflow_command_characters(self):
        self.assertEqual(guard.workflow_command("notice", "100%\nnext"), "::notice::100%25%0Anext")


if __name__ == "__main__":
    unittest.main()
