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

The easiest shared phone notification channel is ntfy.

1. Install the ntfy app on your phone.
2. Subscribe to one private-looking topic name, for example
   `visa-bulletin-eb3-louis-2026`.
3. Put that same topic in a local `.env` file:

```sh
VISA_BULLETIN_NTFY_TOPIC=visa-bulletin-eb3-louis-2026
```

Friends can install the same app and subscribe to the same topic to receive the
same notices.

To send a sample notification:

```sh
python3 visa_bulletin_watch.py --test-notification
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
