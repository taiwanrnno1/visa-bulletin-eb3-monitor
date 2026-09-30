# Visa Bulletin EB-3 Watcher

This folder contains a small watcher for the U.S. Department of State Visa
Bulletin.

It checks the latest Visa Bulletin page and extracts:

- Section: `A. FINAL ACTION DATES FOR EMPLOYMENT-BASED PREFERENCE CASES`
- Row: `3rd`
- Column: `All Chargeability Areas Except Those Listed`

It also compares the new value with the previous bulletin and reports whether
the cutoff date advanced, retrogressed, or stayed the same, including days and
approximate months.

Run it manually with:

```sh
python3 visa_bulletin_watch.py
```

The current bulletin and value are stored in `visa_bulletin_state.json`. Future
runs compare against that file and print a notice whenever a new monthly
bulletin appears, even if the EB-3 value is unchanged. It also reports if the
same bulletin's EB-3 value changes later.

## Phone notifications

The easiest shared phone notification channel is ntfy. This project uses the
free topic:

```text
visa-bulletin-eb3-taiwanrnno1
```

1. Install the ntfy app on your phone.
2. Subscribe to `visa-bulletin-eb3-taiwanrnno1`.
3. Friends can subscribe to the same topic to receive the same monthly notices.

For local testing, put that same topic in a local `.env` file:

```sh
VISA_BULLETIN_NTFY_TOPIC=visa-bulletin-eb3-taiwanrnno1
```

To send a sample notification:

```sh
python3 visa_bulletin_watch.py --test-notification
```

## Free GitHub Pages automation

The free setup is:

- GitHub Pages hosts the Chinese dashboard.
- Cloudflare checks official Visa Bulletin pages every 10 minutes without AI.
- GitHub Actions independently checks cloud health hourly and saves a static backup.
- The Cloudflare Worker sends browser push for verified new bulletins or revisions.
- GitHub does not broadcast, so it cannot duplicate the cloud alerts.

After pushing this repo to GitHub:

1. Go to `Settings` -> `Pages`.
2. Under `Build and deployment`, choose `Deploy from a branch`.
3. Choose branch `main` and folder `/(root)`, then click `Save`.
4. Go to `Settings` -> `Secrets and variables` -> `Actions`.
5. Add a repository secret named `NTFY_TOPIC`.
6. Set the value to `visa-bulletin-eb3-taiwanrnno1`.
7. Go to the `Actions` tab, open `Check Visa Bulletin`, and run it once with
   `Run workflow`.

## Optional browser push with Cloudflare Workers

This is the free native browser-notification option. It stores only browser push
subscriptions, not each person's Priority Date.

Cloudflare Worker files live in `worker/`.

1. Create a Cloudflare Workers KV namespace.
2. Put the KV namespace id into `worker/wrangler.toml`.
3. Deploy the Worker with Wrangler.
4. Add Worker secrets:

```sh
VAPID_PRIVATE_JWK
BROADCAST_SECRET
```

5. Add GitHub Actions secrets:

```sh
WORKER_BROADCAST_URL
WORKER_BROADCAST_SECRET
```

`WORKER_BROADCAST_URL` should look like:

```text
https://YOUR_WORKER_URL/api/broadcast
```

The current Worker URL is:

```text
https://visa-bulletin-eb3-push.t6213982-32d.workers.dev
```

## Web dashboard

Run the local web dashboard with:

```sh
python3 web_monitor.py
```

Then open:

```text
http://127.0.0.1:8787
```

Keep the page open to get browser notifications. Click `Enable notifications`
once, then the page will check every 30 minutes while it is open. The existing
background automation and ntfy phone notifications are still the better choice
for alerts when the page is closed.

The dashboard is in Chinese, shows a supportive message for advancement,
no-change, or retrogression, and lets you save your own Priority Date to compare
against the latest published EB-3 cutoff date.

## PWA and phone push

The app now includes a PWA manifest, service worker, per-device PD storage, and
web-push subscription endpoints.

For local development:

```sh
python3 web_monitor.py
```

For deployment, install:

```sh
pip install -r requirements.txt
```

Then run:

```sh
python3 web_monitor.py
```

Use an HTTPS public URL. Android users can usually enable notifications from
Chrome. iPhone users should add the site to the Home Screen, open it from there,
then enable notifications.

Each phone/browser gets its own `deviceId`; its PD and push subscription are
stored separately in `push_users.json`, so people do not share or overwrite each
other's PD.

Keep the same VAPID keys between deploys. Either preserve `vapid_keys.json` or
set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as environment variables.

## Zero-token cloud monitor

The Worker now contains an official-only monitor (`worker/src/monitor.js`).
It does not call an AI API. The cron runs at UTC minutes 03, 13, 23, 33, 43,
and 53 when `MONITOR_ENABLED = "true"`. Live official-source verification and
a real delivery check passed on 2026-09-29 (22 sent, 0 failed). The legacy
GitHub publisher is replaced by a health check/static backup. Codex was paused after successful scheduled runs were verified on 2026-09-30 UTC.

- Validates the official bulletin URL/month and **employment table A**, exact
  **3rd** row and **All Chargeability Areas Except Those Listed** column.
- Uses travel.state.gov first, then the same official pages on the publicly
  indexed childabduction.state.gov and adoptions.state.gov hosts. Records all
  actual verification URLs; no third-party cutoff values are used.
- Rejects missing/ambiguous tables, invalid dates, stale month regressions,
  blocked pages and non-official sources. `C` and `U` are explicit statuses.
- Rechecks the current and previous calendar month's official tables each run.
- Stores the observation plus pending events before delivery. Successful
  recipient receipts prevent ordinary duplicate deliveries; only failed
  recipients retry. Invalid/expired subscriptions are removed.
- Source failures keep the last verified state. Six consecutive failures cause
  a daily-limited outage push; `/api/status` flags data older than 30 minutes.
- `/api/health` returns 503 when an enabled monitor is stale or delivery failed.
  An independent uptime monitor is recommended to detect total Worker outages;
  a stopped Worker cannot alert about itself.

The existing KV namespace is reused under reserved `monitor:` keys. Old push
subscription keys and VAPID keys are preserved. No browser re-subscription is
required. Delivery is **at least once**, not exactly once: KV is eventually
consistent, and a crash between delivery and saving its receipt can duplicate
an alert. Browser notification tags collapse repeated visible notifications.
Keep manual checks and cron runs from overlapping. Do not roll back to the old
unfiltered broadcaster while `monitor:` keys remain in this namespace.

### Validation and deployment

```sh
cd worker
npm test
npx wrangler deploy --dry-run
npx wrangler whoami
npx wrangler deploy --keep-vars
```

Private POST endpoints `/api/monitor/probe` (read-only source verification) and
`/api/monitor/check` (persist and notify) require the `MONITOR_ADMIN_SECRET`
bearer token. The local credential is in ignored, mode-0600
`worker/.monitor-admin.json`; never commit or print it. Existing
`BROADCAST_SECRET` remains separate and unchanged.

After an authenticated cloud probe succeeds, verify the real change notice
and delivery counts, enable `MONITOR_ENABLED`, and wait for a successful
scheduled run. Only then pause the Codex automation and disable the duplicate
GitHub scheduled publisher. Deploy the updated dashboard at the same time;
it reads `/api/status` and labels its static backup as unverified/cached.

Before this change, the last listed Worker version was
`d82c4b06-f4c3-474c-bb54-a507a8657133`. Prefer disabling `MONITOR_ENABLED`
over rolling back the broadcaster, because old code does not filter monitor
keys from the shared subscription namespace.

Run `python3 worker/scripts/verify-monitor.py` for a private read-only cloud probe.
Add `--check` only to perform a real notifying check; avoid overlapping cron.
The hourly GitHub health workflow fails if the monitor is disabled, stale or
unhealthy; enable GitHub Actions failure notifications for an independent alert.

Older chart history is retained in `worker/src/legacy-history.js` and marked
`legacy_cached`; the current and previous month are reverified against official
pages on every check. Dated legacy broadcasts are suppressed while the cloud
monitor is enabled, preventing a second publisher from repeating alerts.
