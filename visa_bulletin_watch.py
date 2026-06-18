#!/usr/bin/env python3
"""Watch the Visa Bulletin EB-3 final action date.

Fetches the latest Visa Bulletin from travel.state.gov and reports when the
latest monthly bulletin is published, including the Employment-Based 3rd
preference / All Chargeability final action date.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin
from urllib.request import Request, urlopen


INDEX_URL = "https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html"
STATE_PATH = Path(__file__).with_name("visa_bulletin_state.json")
ENV_PATH = Path(__file__).with_name(".env")
MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}
DATE_MONTHS = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}


@dataclass(frozen=True)
class BulletinLink:
    label: str
    url: str
    year: int
    month: int


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attrs_dict = dict(attrs)
        self._href = attrs_dict.get("href")
        self._parts = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href:
            label = normalize_text(" ".join(self._parts))
            self.links.append((self._href, label))
            self._href = None
            self._parts = []


class TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def fetch(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "VisaBulletinWatch/1.0 (+local personal monitor)",
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def send_ntfy(title: str, message: str) -> None:
    topic = os.environ.get("VISA_BULLETIN_NTFY_TOPIC", "").strip()
    if not topic:
        return

    server = os.environ.get("VISA_BULLETIN_NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    url = f"{server}/{topic}"
    request = Request(
        url,
        data=message.encode("utf-8"),
        method="POST",
        headers={
            "Title": title,
            "Tags": "calendar,briefcase",
            "Priority": "default",
            "Content-Type": "text/plain; charset=utf-8",
            "User-Agent": "VisaBulletinWatch/1.0 (+local personal monitor)",
        },
    )
    with urlopen(request, timeout=30) as response:
        response.read()


def parse_bulletin_links(html: str) -> list[BulletinLink]:
    parser = LinkParser()
    parser.feed(html)
    found: list[BulletinLink] = []

    for href, label in parser.links:
        match = re.search(
            r"Visa Bulletin (?:For|for)?\s*([A-Za-z]+)\s+(\d{4})",
            label,
            flags=re.IGNORECASE,
        )
        if not match:
            continue
        month_name = match.group(1).lower()
        if month_name not in MONTHS:
            continue
        found.append(
            BulletinLink(
                label=label,
                url=urljoin(INDEX_URL, href),
                year=int(match.group(2)),
                month=MONTHS[month_name],
            )
        )

    return found


def latest_bulletin_link(links: Iterable[BulletinLink]) -> BulletinLink:
    ordered = sorted(links, key=lambda item: (item.year, item.month), reverse=True)
    if not ordered:
        raise RuntimeError("Could not find any Visa Bulletin links on the index page.")
    return ordered[0]


def previous_bulletin_link(links: Iterable[BulletinLink], latest: BulletinLink) -> BulletinLink | None:
    ordered = sorted(links, key=lambda item: (item.year, item.month), reverse=True)
    for item in ordered:
        if (item.year, item.month) < (latest.year, latest.month):
            return item
    return None


def html_to_text(html: str) -> str:
    parser = TextParser()
    parser.feed(html)
    return "\n".join(normalize_text(part) for part in parser.parts if normalize_text(part))


def extract_eb3_all_chargeability(text: str) -> str:
    start_marker = "FINAL ACTION DATES FOR EMPLOYMENT-BASED PREFERENCE CASES"
    end_marker = "DATES FOR FILING OF EMPLOYMENT-BASED VISA APPLICATIONS"

    start = text.find(start_marker)
    if start == -1:
        raise RuntimeError("Could not find the employment-based final action section.")

    end = text.find(end_marker, start)
    if end == -1:
        end = len(text)

    section = text[start:end]
    for raw_line in section.splitlines():
        line = normalize_text(raw_line)
        match = re.match(r"^3rd\s+(\S+)", line)
        if match:
            return match.group(1)

    compact = normalize_text(section)
    match = re.search(r"\b3rd\s+(\S+)\s+\S+\s+\S+\s+\S+\s+\S+", compact)
    if match:
        return match.group(1)

    raise RuntimeError("Could not find the EB-3 row in the employment-based final action table.")


def load_state(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(path: Path, state: dict[str, object]) -> None:
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_cutoff_date(value: object) -> date | None:
    text = str(value or "").strip().upper()
    match = re.fullmatch(r"(\d{2})([A-Z]{3})(\d{2})", text)
    if not match:
        return None

    day = int(match.group(1))
    month = DATE_MONTHS.get(match.group(2))
    year = int(match.group(3))
    if month is None:
        return None

    full_year = 2000 + year if year < 70 else 1900 + year
    return date(full_year, month, day)


def describe_movement(previous_value: object, current_value: object) -> dict[str, object]:
    previous_text = str(previous_value or "").strip().upper()
    current_text = str(current_value or "").strip().upper()

    if not previous_text:
        return {
            "kind": "unknown",
            "label": "沒有上個月資料",
            "days": None,
            "months": None,
        }

    if previous_text == current_text:
        return {
            "kind": "same",
            "label": "沒有變化",
            "days": 0,
            "months": 0,
        }

    previous_date = parse_cutoff_date(previous_text)
    current_date = parse_cutoff_date(current_text)
    if previous_date is None or current_date is None:
        return {
            "kind": "status_changed",
            "label": f"狀態從 {previous_text} 變成 {current_text}",
            "days": None,
            "months": None,
        }

    delta_days = (current_date - previous_date).days
    direction = "advanced" if delta_days > 0 else "retrogressed"
    absolute_days = abs(delta_days)
    approx_months = round(absolute_days / 30.4375, 1)
    label_direction = "前進" if delta_days > 0 else "倒退"

    return {
        "kind": direction,
        "label": f"{label_direction} {absolute_days} 天，約 {approx_months} 個月",
        "days": delta_days,
        "months": approx_months,
    }


def build_notice(
    previous: dict[str, object],
    current: dict[str, object],
) -> dict[str, object]:
    previous_value = previous.get("eb3_all_chargeability_final_action_date")
    previous_url = previous.get("source_url")
    previous_bulletin = previous.get("bulletin")
    previous_month_value = current.get("previous_bulletin_eb3_all_chargeability_final_action_date")
    previous_month_label = current.get("previous_bulletin")
    previous_month_url = current.get("previous_bulletin_source_url")

    value = str(current["eb3_all_chargeability_final_action_date"])
    latest_label = str(current["bulletin"])
    latest_url = str(current["source_url"])
    movement = describe_movement(previous_month_value, value)

    new_bulletin = previous_url != latest_url
    value_changed = previous_value != value

    if new_bulletin:
        old_bulletin = previous_bulletin if previous_bulletin is not None else "沒有上次公告"
        lines = [
            f"新的 Visa Bulletin 已公布：{old_bulletin} -> {latest_label}",
            f"EB-3 All Chargeability 本月公布日期：{value}",
            f"相較上個月：{movement['label']}",
        ]
        if previous_month_label is not None:
            lines.append(f"比較基準：{previous_month_label}")
        if previous_month_value is not None and previous_month_value != value:
            lines.append(f"上個月數值：{previous_month_value}")
        if previous_month_url is not None:
            lines.append(f"上個月來源：{previous_month_url}")
        lines.append(f"官方來源：{latest_url}")
        return {
            "status": "new_bulletin",
            "notify": True,
            "title": "新的 Visa Bulletin 已公布",
            "message": "\n".join(lines),
            "previous_value": previous_month_value,
            "movement": movement,
            "current": current,
        }

    if value_changed:
        old_display = previous_month_value if previous_month_value is not None else "沒有上個月數值"
        lines = [
            f"EB-3 All Chargeability 數值更新：{old_display} -> {value}",
            f"相較上個月：{movement['label']}",
            f"比較基準：{previous_month_label}",
            f"公告月份：{latest_label}",
            f"官方來源：{latest_url}",
        ]
        return {
            "status": "value_changed",
            "notify": True,
            "title": "Visa Bulletin EB-3 數值更新",
            "message": "\n".join(lines),
            "previous_value": previous_month_value,
            "movement": movement,
            "current": current,
        }

    return {
        "status": "no_change",
        "notify": False,
        "title": "沒有變化",
        "message": f"沒有變化。EB-3 All Chargeability 仍是 {value}。\n公告月份：{latest_label}",
        "previous_value": previous_month_value,
        "movement": movement,
        "current": current,
    }


def fetch_current_result(state_path: Path) -> tuple[dict[str, object], dict[str, object]]:
    index_html = fetch(INDEX_URL)
    links = parse_bulletin_links(index_html)
    latest = latest_bulletin_link(links)
    previous_bulletin = previous_bulletin_link(links, latest)
    bulletin_html = fetch(latest.url)
    value = extract_eb3_all_chargeability(html_to_text(bulletin_html))

    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    previous = load_state(state_path)
    previous_month_value = None
    previous_month_label = None
    previous_month_url = None
    if previous_bulletin is not None:
        previous_month_html = fetch(previous_bulletin.url)
        previous_month_value = extract_eb3_all_chargeability(html_to_text(previous_month_html))
        previous_month_label = previous_bulletin.label
        previous_month_url = previous_bulletin.url

    current = {
        "checked_at": checked_at,
        "bulletin": latest.label,
        "source_url": latest.url,
        "eb3_all_chargeability_final_action_date": value,
        "previous_bulletin": previous_month_label,
        "previous_bulletin_source_url": previous_month_url,
        "previous_bulletin_eb3_all_chargeability_final_action_date": previous_month_value,
    }
    current["movement_from_previous_bulletin"] = describe_movement(
        previous_month_value,
        value,
    )

    return previous, current


def check_once(state_path: Path, dry_run: bool) -> int:
    previous, current = fetch_current_result(state_path)
    notice = build_notice(previous, current)

    if not dry_run:
        save_state(state_path, current)

    print(str(notice["message"]))
    if notice["notify"] and not dry_run:
        send_ntfy(str(notice["title"]), str(notice["message"]))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch Visa Bulletin EB-3 All Chargeability.")
    parser.add_argument("--state", type=Path, default=STATE_PATH, help="Path to the JSON state file.")
    parser.add_argument("--dry-run", action="store_true", help="Do not write the state file.")
    parser.add_argument("--test-notification", action="store_true", help="Send a sample phone notification.")
    args = parser.parse_args()

    try:
        load_env_file(ENV_PATH)
        if args.test_notification:
            send_ntfy(
                "Visa Bulletin 測試通知",
                "這是你的 Visa Bulletin EB-3 監控測試通知。",
            )
            print("測試通知已送出。")
            return 0
        return check_once(args.state, args.dry_run)
    except Exception as exc:
        print(f"Visa Bulletin check failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
