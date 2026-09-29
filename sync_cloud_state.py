#!/usr/bin/env python3
"""Zero-AI independent health check and static dashboard backup; never pushes."""
import json
from datetime import datetime, timezone
from urllib.request import Request, urlopen
import visa_bulletin_watch as watcher
from github_action_check import meaningful_state_changed

BASE = 'https://visa-bulletin-eb3-push.t6213982-32d.workers.dev'

def get_json(path):
    with urlopen(Request(BASE + path, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}), timeout=30) as response:
        return json.load(response)

def main():
    health = get_json('/api/health')
    if not health.get('monitor_enabled') or not health.get('healthy'):
        raise RuntimeError('Cloud monitor disabled or unhealthy; inspect /api/health')
    result = get_json('/api/status')
    current = result.get('state') or {}
    if not result.get('ok') or result.get('stale') or not current.get('official_verified'):
        raise RuntimeError('No fresh, officially verified bulletin; cached state retained')
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(current['checked_at'].replace('Z', '+00:00'))).total_seconds()
    if not 0 <= age <= 1800:
        raise RuntimeError('Official check is stale; cached state retained')
    previous = watcher.load_state(watcher.STATE_PATH)
    if meaningful_state_changed(previous, current):
        watcher.save_state(watcher.STATE_PATH, current)
        print('Updated verified static backup:', current['bulletin'])
    else:
        print('Cloud monitor healthy; official bulletin unchanged. No push sent.')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
