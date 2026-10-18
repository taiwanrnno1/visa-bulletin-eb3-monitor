import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.error import HTTPError, URLError
import sync_cloud_state as sync


def stamp(minutes=0):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def status(**changes):
    result = {'ok': True, 'stale': False, 'state': {
        'official_verified': True, 'checked_at': stamp(), 'bulletin': 'test'}}
    result.update(changes)
    return result


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict('os.environ', {'MONITOR_ADMIN_SECRET': 'test-secret'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def run_main(self, responses):
        with patch.object(sync, 'get_json', side_effect=responses) as get, \
             patch.object(sync.watcher, 'load_state', return_value={}), \
             patch.object(sync.watcher, 'save_state') as save, \
             patch.object(sync.time, 'sleep'):
            sync.main()
            return get.call_args_list, save

    def test_healthy_never_requests_recovery(self):
        calls, save = self.run_main([{'monitor_enabled': True, 'healthy': True}, status()])
        self.assertEqual([call.args[0] for call in calls], ['/api/health', '/api/status'])
        save.assert_called_once()

    def test_missed_run_recovers_once_then_waits_for_fresh_state(self):
        calls, save = self.run_main([
            {'monitor_enabled': True, 'healthy': False, 'health': {'last_attempt': stamp(300)}},
            {'ok': True}, status(stale=True), status()])
        self.assertEqual(sum(c.args[0] == '/api/monitor/check' for c in calls), 1)
        self.assertEqual(calls[1].kwargs, {'method': 'POST', 'token': 'test-secret'})
        save.assert_called_once()

    def test_unhealthy_cases_do_not_write_backup(self):
        cases = [
            [{'monitor_enabled': False}],
            [{'monitor_enabled': True, 'healthy': False, 'health': {'last_attempt': stamp(), 'last_error': 'Official HTTP 403'}}],
            [{'monitor_enabled': True, 'healthy': False}, {'ok': False}],
            [{'monitor_enabled': True, 'healthy': True}, status(stale=True)],
            [{'monitor_enabled': True, 'healthy': True}, status(state={'official_verified': True, 'checked_at': stamp(90)})],
            [{'monitor_enabled': True, 'healthy': True}, status(state={'official_verified': True, 'checked_at': stamp(-5)})],
            [{'monitor_enabled': True, 'healthy': True}, status(state={'official_verified': False, 'checked_at': stamp()})],
        ]
        for responses in cases:
            with self.subTest(responses=responses), patch.object(sync, 'get_json', side_effect=responses), patch.object(sync.watcher, 'save_state') as save:
                with self.assertRaises(RuntimeError): sync.main()
                save.assert_not_called()

    def test_health_503_preserves_json_diagnostics(self):
        body = {'healthy': False, 'health': {'last_error': 'official unavailable'}}
        error = HTTPError('https://example.test', 503, 'Unavailable', {}, io.BytesIO(json.dumps(body).encode()))
        with patch.object(sync, 'urlopen', side_effect=error):
            self.assertEqual(sync.get_json('/api/health'), body)

    def test_read_retries_but_recovery_post_does_not(self):
        with patch.object(sync, 'urlopen', side_effect=URLError('temporary')) as read, patch.object(sync.time, 'sleep'):
            with self.assertRaises(RuntimeError): sync.get_json('/api/status')
            self.assertEqual(read.call_count, 3)
        with patch.object(sync, 'urlopen', side_effect=TimeoutError('timeout')) as post:
            with self.assertRaises(RuntimeError): sync.get_json('/api/monitor/check', method='POST', token='test-secret')
            self.assertEqual(post.call_count, 1)

    def test_missing_secret_does_not_request_recovery(self):
        with patch.dict('os.environ', {'MONITOR_ADMIN_SECRET': ''}), patch.object(sync, 'get_json', return_value={'monitor_enabled': True, 'healthy': False}) as get:
            with self.assertRaisesRegex(RuntimeError, 'configure MONITOR_ADMIN_SECRET'): sync.main()
            self.assertEqual(get.call_count, 1)

    def test_unchanged_bulletin_does_not_write_backup(self):
        current = status()
        with patch.object(sync, 'get_json', side_effect=[{'monitor_enabled': True, 'healthy': True}, current]), patch.object(sync.watcher, 'load_state', return_value={**current['state'], 'checked_at': stamp(20)}), patch.object(sync.watcher, 'save_state') as save:
            sync.main()
            save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
