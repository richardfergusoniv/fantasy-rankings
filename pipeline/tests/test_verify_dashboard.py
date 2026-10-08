"""The props workflow reads the stored snapshot with the existing cron secret."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from unittest.mock import patch


def _module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "verify_dashboard.py"
    spec = importlib.util.spec_from_file_location("verify_dashboard", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_stored_snapshot_request_sends_the_cron_secret_and_unwraps_dashboard():
    module = _module()
    payload = {"ok": True, "dashboard": {"week": 5, "rankings": []}}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(payload).encode()

    with patch.object(module.urllib.request, "urlopen", return_value=FakeResponse()) as urlopen:
        dashboard = module.stored_snapshot_request(
            "https://example.test/api/cron/jobs?job=read-dashboard-snapshot",
            "secret",
        )

    request = urlopen.call_args.args[0]
    assert request.full_url.endswith("job=read-dashboard-snapshot")
    assert request.get_header("Authorization") == "Bearer secret"
    assert dashboard == payload["dashboard"]


def test_stored_snapshot_request_rejects_a_body_without_a_dashboard():
    module = _module()

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"ok": true}'

    with patch.object(module.urllib.request, "urlopen", return_value=FakeResponse()):
        try:
            module.stored_snapshot_request("https://example.test/snapshot", "secret")
        except RuntimeError as error:
            assert "no dashboard" in str(error)
        else:
            raise AssertionError("expected a missing dashboard to fail")
