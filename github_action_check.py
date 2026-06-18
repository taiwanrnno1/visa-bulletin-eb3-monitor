#!/usr/bin/env python3
"""GitHub Actions entrypoint for the free static-site monitor."""

from __future__ import annotations

import os

import visa_bulletin_watch as watcher


def main() -> int:
    previous, current = watcher.fetch_current_result(watcher.STATE_PATH)
    notice = watcher.build_notice(previous, current)
    print(str(notice["message"]))

    if not notice["notify"]:
        print("沒有新公告，這次不更新網站檔案。")
        return 0

    watcher.save_state(watcher.STATE_PATH, current)
    if os.environ.get("VISA_BULLETIN_NTFY_TOPIC", "").strip():
        watcher.send_ntfy(str(notice["title"]), str(notice["message"]))
        print("ntfy 手機通知已送出。")
    else:
        print("沒有設定 ntfy topic，所以只更新網站檔案。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
