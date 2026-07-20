#!/usr/bin/env python3
"""Check Visa Bulletin and notify saved web-push subscribers."""

from __future__ import annotations

import visa_bulletin_watch as watcher


def main() -> int:
    watcher.load_env_file(watcher.ENV_PATH)
    previous, current = watcher.fetch_current_result(watcher.STATE_PATH)
    notice = watcher.build_notice(previous, current)
    print(str(notice["message"]))

    if notice["notify"]:
        push_result = watcher.send_web_push_broadcast(notice)
        print(
            "瀏覽器推播完成："
            f"sent={push_result.get('sent', 0)}, failed={push_result.get('failed', 0)}"
        )

    watcher.save_state(watcher.STATE_PATH, current)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
