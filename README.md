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
- GitHub Actions checks the official Visa Bulletin every 4 hours.
- ntfy sends phone notifications when a new monthly bulletin is published, even
  if the EB-3 date did not move.

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
