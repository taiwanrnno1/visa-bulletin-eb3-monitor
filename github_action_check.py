#!/usr/bin/env python3
"""GitHub Actions entrypoint for the free static-site monitor."""

from __future__ import annotations

import os
import json
from urllib.request import Request, urlopen

import visa_bulletin_watch as watcher


def meaningful_state_changed(previous: dict[str, object], current: dict[str, object]) -> bool:
    """Ignore checked_at so hourly checks do not create noisy commits."""
    previous_without_check_time = dict(previous or {})
    current_without_check_time = dict(current or {})
    previous_without_check_time.pop("checked_at", None)
    current_without_check_time.pop("checked_at", None)
    return previous_without_check_time != current_without_check_time


def notify_worker(notice: dict[str, object]) -> None:
    url = os.environ.get("WORKER_BROADCAST_URL", "").strip()
    secret = os.environ.get("WORKER_BROADCAST_SECRET", "").strip()
    if not url or not secret:
        print("沒有設定 Cloudflare Worker broadcast，所以略過瀏覽器推播。")
        return

    request = Request(
        url,
        data=json.dumps({"notice": notice}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "VisaBulletinWatch/1.0 (+github-actions)",
        },
    )
    with urlopen(request, timeout=45) as response:
        print(response.read().decode("utf-8", errors="replace"))


def main() -> int:
    previous, current = watcher.fetch_current_result(watcher.STATE_PATH)
    notice = watcher.build_notice(previous, current)
    print(str(notice["message"]))

    state_changed = meaningful_state_changed(previous, current)
    if state_changed:
        watcher.save_state(watcher.STATE_PATH, current)
        print("偵測到公告月份、排期數值或歷史資料變化，已更新網站資料。")
    else:
        print("公告內容沒有變化；略過 checked_at，避免產生不必要的 GitHub commit。")

    if not notice["notify"]:
        print("沒有新公告。")
        return 0

    if os.environ.get("VISA_BULLETIN_NTFY_TOPIC", "").strip():
        watcher.send_ntfy(str(notice["title"]), str(notice["message"]))
        print("ntfy 手機通知已送出。")
    else:
        print("沒有設定 ntfy topic，所以只更新網站檔案。")
    notify_worker(notice)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
