#!/usr/bin/env python3
"""Local web dashboard for the Visa Bulletin EB-3 monitor."""

from __future__ import annotations

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.parse import parse_qs

import visa_bulletin_watch as watcher


ROOT = Path(__file__).resolve().parent
USERS_PATH = ROOT / "push_users.json"
VAPID_PATH = ROOT / "vapid_keys.json"


def b64url(data: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def load_json(path: Path, fallback: object) -> object:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def get_vapid_keys() -> dict[str, str]:
    public_key = os.environ.get("VAPID_PUBLIC_KEY")
    private_key = os.environ.get("VAPID_PRIVATE_KEY")
    if public_key and private_key:
        return {"publicKey": public_key, "privateKey": private_key}

    if VAPID_PATH.exists():
        return json.loads(VAPID_PATH.read_text(encoding="utf-8"))

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    public_numbers = private_key.public_key().public_numbers()
    public_key = b"\x04" + public_numbers.x.to_bytes(32, "big") + public_numbers.y.to_bytes(32, "big")
    keys = {"publicKey": b64url(public_key), "privateKey": private_pem}
    save_json(VAPID_PATH, keys)
    return keys


def pd_gap_text(pd_value: object, cutoff_value: object) -> str:
    pd_date = watcher.parse_cutoff_date(str(pd_value).replace("-", "").upper()) if pd_value else None
    if pd_date is None and pd_value:
        try:
            from datetime import date

            year, month, day = [int(part) for part in str(pd_value).split("-")]
            pd_date = date(year, month, day)
        except Exception:
            pd_date = None
    cutoff_date = watcher.parse_cutoff_date(cutoff_value)
    if pd_date is None or cutoff_date is None:
        return ""
    days = (cutoff_date - pd_date).days
    if days > 0:
        return f"你的 PD 已早於最新公布日期。"
    if days == 0:
        return "你的 PD 剛好等於最新公布日期。"
    months = round(abs(days) / 30.4375, 1)
    return f"你的 PD 距離最新公布日期還差 {abs(days)} 天，約 {months} 個月。"


def send_push(subscription: dict[str, object], title: str, body: str) -> tuple[bool, str]:
    try:
        from pywebpush import WebPushException, webpush
    except Exception:
        return False, "pywebpush is not installed. Run `pip install -r requirements.txt` on the deployed server."

    try:
        keys = get_vapid_keys()
        webpush(
            subscription_info=subscription,
            data=json.dumps({"title": title, "body": body, "url": "/"}),
            vapid_private_key=keys["privateKey"],
            vapid_claims={"sub": "mailto:visa-bulletin-monitor@example.com"},
        )
        return True, "sent"
    except Exception as exc:
        if exc.__class__.__name__ == "WebPushException":
            return False, str(exc)
        return False, str(exc)


def notify_subscribers(notice: dict[str, object]) -> dict[str, object]:
    users = load_json(USERS_PATH, {})
    current = notice.get("current", {})
    sent = 0
    failed = 0
    errors: list[str] = []
    for device_id, user in dict(users).items():
        subscription = user.get("subscription") if isinstance(user, dict) else None
        if not subscription:
            continue
        gap = pd_gap_text(user.get("pd"), current.get("eb3_all_chargeability_final_action_date"))
        body = str(notice["message"])
        if gap:
            body = f"{body}\n{gap}"
        ok, message = send_push(subscription, str(notice["title"]), body)
        if ok:
            sent += 1
        else:
            failed += 1
            errors.append(f"{device_id}: {message}")
    return {"sent": sent, "failed": failed, "errors": errors[:5]}


class MonitorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/status":
            self.respond_status()
            return
        if path == "/api/vapid-public-key":
            self.respond_json({"ok": True, "publicKey": get_vapid_keys()["publicKey"]})
            return
        if path == "/api/device":
            device_id = parse_qs(parsed.query).get("deviceId", [""])[0]
            users = load_json(USERS_PATH, {})
            self.respond_json({"ok": True, "device": users.get(device_id, {}) if isinstance(users, dict) else {}})
            return
        if path == "/api/check":
            self.respond_check()
            return
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/web/")
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            self.respond_json({"ok": False, "error": "Invalid JSON"}, status=400)
            return

        if path == "/api/save-device":
            self.respond_save_device(payload)
            return
        if path == "/api/test-push":
            self.respond_test_push(payload)
            return
        self.respond_json({"ok": False, "error": "Not found"}, status=404)

    def respond_json(self, payload: dict[str, object], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def respond_status(self) -> None:
        state = watcher.load_state(watcher.STATE_PATH)
        self.respond_json({"ok": True, "state": state})

    def respond_check(self) -> None:
        try:
            watcher.load_env_file(watcher.ENV_PATH)
            previous, current = watcher.fetch_current_result(watcher.STATE_PATH)
            notice = watcher.build_notice(previous, current)
            watcher.save_state(watcher.STATE_PATH, current)
            if notice["notify"]:
                watcher.send_ntfy(str(notice["title"]), str(notice["message"]))
                push_result = notify_subscribers(notice)
            else:
                push_result = {"sent": 0, "failed": 0, "errors": []}
            self.respond_json({"ok": True, "notice": notice, "state": current, "push": push_result})
        except Exception as exc:
            self.respond_json({"ok": False, "error": str(exc)}, status=500)

    def respond_save_device(self, payload: dict[str, object]) -> None:
        device_id = str(payload.get("deviceId", "")).strip()
        if not device_id:
            self.respond_json({"ok": False, "error": "Missing deviceId"}, status=400)
            return
        users = load_json(USERS_PATH, {})
        if not isinstance(users, dict):
            users = {}
        existing = users.get(device_id, {}) if isinstance(users.get(device_id), dict) else {}
        users[device_id] = {
            **existing,
            "pd": str(payload.get("pd", existing.get("pd", ""))).strip(),
            "subscription": payload.get("subscription", existing.get("subscription")),
        }
        save_json(USERS_PATH, users)
        self.respond_json({"ok": True, "device": users[device_id]})

    def respond_test_push(self, payload: dict[str, object]) -> None:
        device_id = str(payload.get("deviceId", "")).strip()
        users = load_json(USERS_PATH, {})
        user = users.get(device_id, {}) if isinstance(users, dict) else {}
        subscription = user.get("subscription") if isinstance(user, dict) else None
        if not subscription:
            self.respond_json({"ok": False, "error": "This device has no push subscription yet."}, status=400)
            return
        ok, message = send_push(subscription, "Visa Bulletin 測試通知", "你的手機推播已經設定完成。")
        self.respond_json({"ok": ok, "message": message}, status=200 if ok else 500)


def main() -> None:
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("0.0.0.0", port), MonitorHandler)
    print(f"Visa Bulletin web monitor running on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
