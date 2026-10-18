#!/usr/bin/env python3
"""Zero-AI health watchdog and verified static backup; Worker owns all pushes."""
import json
import os
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import visa_bulletin_watch as watcher
from github_action_check import meaningful_state_changed

BASE = 'https://visa-bulletin-eb3-push.t6213982-32d.workers.dev'
MAX_AGE_SECONDS = 1800


def get_json(path, *, method='GET', token=None):
    headers = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    # Retry reads only. A timed-out POST may already have completed remotely.
    attempts = 3 if method == 'GET' else 1
    for attempt in range(attempts):
        try:
            request = Request(BASE + path, headers=headers, method=method,
                              data=b'' if method == 'POST' else None)
            try:
                response = urlopen(request, timeout=90 if method == 'POST' else 30)
            except HTTPError as error:
                # Health deliberately uses 503 for stale data. Read its diagnosis.
                if error.code == 503 and path in ('/api/health', '/api/monitor/check'):
                    response = error
                else:
                    raise
            with response:
                return json.load(response)
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            if isinstance(error, HTTPError) and error.code < 500 and error.code != 429:
                raise
            if attempt + 1 == attempts:
                raise RuntimeError(f'{path}: failed after {attempts} attempt(s): {error}') from error
            time.sleep(2 * (attempt + 1))


def age_seconds(timestamp):
    if not timestamp:
        return float('inf')
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(timestamp.replace('Z', '+00:00'))).total_seconds()
    except (ValueError, TypeError):
        return float('inf')


def diagnosis(payload):
    health = payload.get('health') or {}
    return (f"last_attempt={health.get('last_attempt')}; "
            f"last_success={health.get('last_success')}; "
            f"error={health.get('last_error')}; "
            f"delivery_failures={(health.get('delivery') or {}).get('failed', 0)}")


def fresh_state(result):
    current = result.get('state') or {}
    return (result.get('ok') and not result.get('stale')
            and current.get('official_verified')
            and 0 <= age_seconds(current.get('checked_at')) <= MAX_AGE_SECONDS)


def main():
    health = get_json('/api/health')
    if not health.get('monitor_enabled'):
        raise RuntimeError('Cloud monitor disabled; cached state retained')
    recovered = False
    if not health.get('healthy'):
        detail = diagnosis(health)
        # Only recover a missed/stalled run, not a recent official-source or push failure.
        if age_seconds((health.get('health') or {}).get('last_attempt')) <= MAX_AGE_SECONDS:
            raise RuntimeError('Cloud monitor unhealthy; cached state retained. ' + detail)
        token = os.environ.get('MONITOR_ADMIN_SECRET', '').strip()
        if not token:
            raise RuntimeError('Cloud monitor missed checks; configure MONITOR_ADMIN_SECRET for recovery. ' + detail)
        print('Cloud monitor missed checks; requesting one authenticated recovery. ' + detail)
        result = get_json('/api/monitor/check', method='POST', token=token)
        if not result.get('ok'):
            raise RuntimeError('Cloud recovery failed; cached state retained. ' + diagnosis(result))
        recovered = True

    result = get_json('/api/status')
    # KV readers in another location may briefly retain pre-recovery state.
    if recovered:
        for delay in (5, 15, 45):
            if fresh_state(result):
                break
            time.sleep(delay)
            result = get_json('/api/status')
    if not fresh_state(result):
        raise RuntimeError('No fresh, officially verified bulletin; cached state retained. ' + diagnosis(result))
    current = result['state']
    previous = watcher.load_state(watcher.STATE_PATH)
    if meaningful_state_changed(previous, current):
        watcher.save_state(watcher.STATE_PATH, current)
        print('Updated verified static backup:', current['bulletin'])
    else:
        print('Cloud monitor healthy; official bulletin unchanged. No push sent by GitHub.')
    if recovered:
        print('Missed cloud check recovered; fresh official data verified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
