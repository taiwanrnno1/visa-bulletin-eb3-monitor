#!/usr/bin/env python3
"""Private live probe (default) or a real persisted check (--check). Never prints secrets."""
import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true', help='Persist a real check and send any genuine changes')
args = parser.parse_args()
secret = json.loads((Path(__file__).resolve().parents[1] / '.monitor-admin.json').read_text())['MONITOR_ADMIN_SECRET']
base = 'https://visa-bulletin-eb3-push.t6213982-32d.workers.dev'
path = '/api/monitor/check' if args.check else '/api/monitor/probe'
request = Request(base + path, data=b'', method='POST', headers={
    'Authorization': 'Bearer ' + secret, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
})
try:
    with urlopen(request, timeout=90) as response:
        result = json.load(response)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(0 if result.get('ok') else 1)
except HTTPError as error:
    print(f'HTTP {error.code}: {error.read().decode()[:1000]}')
    raise SystemExit(1)
