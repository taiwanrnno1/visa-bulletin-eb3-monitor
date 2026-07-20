#!/usr/bin/env python3
"""GitHub Actions entrypoint for the free static-site monitor."""

from __future__ import annotations

import visa_bulletin_watch as watcher


def meaningful_state_changed(previous: dict[str, object], current: dict[str, object]) -> bool:
    """Ignore checked_at so hourly checks do not create noisy commits."""
    previous_without_check_time = dict(previous or {})
    current_without_check_time = dict(current or {})
    previous_without_check_time.pop("checked_at", None)
    current_without_check_time.pop("checked_at", None)
    return previous_without_check_time != current_without_check_time


def main() -> int:
    try:
        previous, current = watcher.fetch_current_result(watcher.STATE_PATH)
    except watcher.UpstreamFetchError as exc:
        cached = watcher.load_state(watcher.STATE_PATH)
        if not cached:
            raise
        print(f"::warning title=Official Visa Bulletin temporarily unavailable::{exc}")
        print("官方網站暫時拒絕或無法回應，保留上次成功抓到的資料。")
        print(
            "目前快取："
            f"{cached.get('bulletin', '未知公告')} / "
            f"EB-3 All Chargeability {cached.get('eb3_all_chargeability_final_action_date', '未知')}"
        )
        print("沒有送通知；下一次排程會再試。")
        return 0

    if current.get("official_fetch_error"):
        print(
            "::warning title=Official Visa Bulletin blocked; fallback used::"
            f"{current['official_fetch_error']} / "
            f"fallback data: {current.get('fallback_source_url')} / "
            f"cross-check: {current.get('fallback_confirmation_source_url')}"
        )

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

    push_result = watcher.send_web_push_broadcast(notice)
    print(
        "瀏覽器推播完成："
        f"sent={push_result.get('sent', 0)}, failed={push_result.get('failed', 0)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
