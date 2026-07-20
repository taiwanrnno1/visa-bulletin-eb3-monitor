#!/usr/bin/env python3

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import visa_bulletin_watch as watcher


GROUPS_AUGUST = "Visa Bulletin For August 2026"
FALLBACK_AUGUST = """
<html><body>
EB-3: Skilled Workers, Professionals AUG 2026 SEP 01, 2024
</body></html>
"""
FALLBACK_JULY = """
<html><body>
EB-3: Skilled Workers, Professionals JUL 2026 AUG 01, 2024
</body></html>
"""


class SourcePriorityTests(unittest.TestCase):
    def make_state(self, directory: str) -> Path:
        path = Path(directory) / "state.json"
        path.write_text(
            json.dumps(
                {
                    "bulletin": "Visa Bulletin For July 2026",
                    "source_url": watcher.official_bulletin_url(2026, 7),
                    "eb3_all_chargeability_final_action_date": "01AUG24",
                    "history": [
                        {
                            "bulletin": "Visa Bulletin For July 2026",
                            "source_url": watcher.official_bulletin_url(2026, 7),
                            "eb3_all_chargeability_final_action_date": "01AUG24",
                            "year": 2026,
                            "month": 7,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        return path

    def test_google_groups_path_is_used_before_official_site(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = self.make_state(directory)

            def fake_fetch(url: str, attempts: int = 2) -> str:
                if url == watcher.FALLBACK_CONFIRMATION_URL:
                    return GROUPS_AUGUST
                if url == watcher.FALLBACK_CURRENT_URL:
                    return FALLBACK_AUGUST
                self.fail(f"Official site should not be fetched: {url}")

            with patch.object(watcher, "fetch", side_effect=fake_fetch):
                previous, current = watcher.fetch_current_result(state_path)

            self.assertEqual(previous["bulletin"], "Visa Bulletin For July 2026")
            self.assertEqual(current["bulletin"], "Visa Bulletin For August 2026")
            self.assertEqual(current["eb3_all_chargeability_final_action_date"], "01SEP24")
            self.assertEqual(current["movement_from_previous_bulletin"]["days"], 31)
            self.assertNotIn("official_fetch_error", current)

    def test_same_saved_result_does_not_notify_again(self) -> None:
        current = {
            "bulletin": "Visa Bulletin For August 2026",
            "source_url": watcher.official_bulletin_url(2026, 8),
            "eb3_all_chargeability_final_action_date": "01SEP24",
            "previous_bulletin_eb3_all_chargeability_final_action_date": "01AUG24",
        }
        notice = watcher.build_notice(dict(current), current)
        self.assertFalse(notice["notify"])
        self.assertEqual(notice["status"], "no_change")

    def test_unsynchronized_sources_keep_cached_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = self.make_state(directory)

            def fake_fetch(url: str, attempts: int = 2) -> str:
                if url == watcher.FALLBACK_CONFIRMATION_URL:
                    return GROUPS_AUGUST
                if url == watcher.FALLBACK_CURRENT_URL:
                    return FALLBACK_JULY
                if url == watcher.INDEX_URL:
                    raise watcher.UpstreamFetchError("HTTP 403")
                self.fail(f"Unexpected URL: {url}")

            with patch.object(watcher, "fetch", side_effect=fake_fetch):
                with self.assertRaises(watcher.UpstreamFetchError):
                    watcher.fetch_current_result(state_path)

            cached = watcher.load_state(state_path)
            self.assertEqual(cached["bulletin"], "Visa Bulletin For July 2026")
            self.assertEqual(cached["eb3_all_chargeability_final_action_date"], "01AUG24")

    def test_browser_push_requires_deployment_credentials(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "browser push was not sent"):
                watcher.send_web_push_broadcast({"title": "test", "message": "test"})

    def test_browser_push_reports_worker_counts(self) -> None:
        response = MagicMock()
        response.read.return_value = b'{"ok":true,"sent":2,"failed":1}'
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        with patch.dict(
            os.environ,
            {
                "WORKER_BROADCAST_URL": "https://push.example.test",
                "WORKER_BROADCAST_SECRET": "secret",
            },
            clear=True,
        ):
            with patch.object(watcher, "urlopen", return_value=response):
                result = watcher.send_web_push_broadcast(
                    {"title": "test", "message": "test", "current": {}}
                )

        self.assertEqual(result["sent"], 2)
        self.assertEqual(result["failed"], 1)


if __name__ == "__main__":
    unittest.main()
