#!/usr/bin/env python3
"""GitHub Actions entrypoint for the free static-site monitor."""

from __future__ import annotations

import os
import json
from urllib.request import Request, urlopen

import visa_bulletin_watch as watcher


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
    watcher.save_state(watcher.STATE_PATH, current)

    if not notice["notify"]:
        print("沒有新公告，這次只更新最後檢查時間。")
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
