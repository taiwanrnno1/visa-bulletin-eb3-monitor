#!/usr/bin/env python3
"""Check Visa Bulletin and notify saved web-push subscribers."""

from __future__ import annotations

import json
import visa_bulletin_watch as watcher
import web_monitor


def main() -> int:
    watcher.load_env_file(watcher.ENV_PATH)
    previous, current = watcher.fetch_current_result(watcher.STATE_PATH)
    notice = watcher.build_notice(previous, current)
    watcher.save_state(watcher.STATE_PATH, current)

    result = {"notice": notice["message"], "push": {"sent": 0, "failed": 0, "errors": []}}
    print(str(notice["message"]))

    if notice["notify"]:
        watcher.send_ntfy(str(notice["title"]), str(notice["message"]))
        result["push"] = web_monitor.notify_subscribers(notice)
        print(json.dumps(result["push"], ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
