const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const PD_STORAGE_KEY = "visaBulletinEb3PriorityDate";
const DEVICE_ID_STORAGE_KEY = "visaBulletinEb3DeviceId";
const WORKER_BASE_STORAGE_KEY = "visaBulletinEb3WorkerBase";
const PUSH_WORKER_BASE = "https://visa-bulletin-eb3-push.t6213982-32d.workers.dev";
const NTFY_TOPIC = "visa-bulletin-eb3-taiwanrnno1";
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

const state = {
  timer: null,
  checking: false,
  current: null,
  backendAvailable: true,
};

const monthMap = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  dateValue: document.querySelector("#dateValue"),
  movementValue: document.querySelector("#movementValue"),
  previousSourceLink: document.querySelector("#previousSourceLink"),
  bulletinValue: document.querySelector("#bulletinValue"),
  checkedValue: document.querySelector("#checkedValue"),
  noticeText: document.querySelector("#noticeText"),
  checkNow: document.querySelector("#checkNow"),
  enableNotifications: document.querySelector("#enableNotifications"),
  ntfyLink: document.querySelector("#ntfyLink"),
  sourceLink: document.querySelector("#sourceLink"),
  messagePanel: document.querySelector("#messagePanel"),
  messageKicker: document.querySelector("#messageKicker"),
  encouragementTitle: document.querySelector("#encouragementTitle"),
  encouragementText: document.querySelector("#encouragementText"),
  fireworks: document.querySelector("#fireworks"),
  pdForm: document.querySelector("#pdForm"),
  pdInput: document.querySelector("#pdInput"),
  pdDatePicker: document.querySelector("#pdDatePicker"),
  pdResult: document.querySelector("#pdResult"),
};

function formatChecked(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW");
}

function setStatus(text, kind = "idle") {
  els.connectionStatus.textContent = text;
  els.connectionStatus.dataset.kind = kind;
}

function getDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  }
  return deviceId;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function pushWorkerBase() {
  return (localStorage.getItem(WORKER_BASE_STORAGE_KEY) || PUSH_WORKER_BASE).replace(/\/+$/, "");
}

function isStaticSite() {
  return window.location.hostname.endsWith("github.io");
}

async function saveDevice({ subscription = undefined } = {}) {
  if (!state.backendAvailable) return;
  const payload = {
    deviceId: getDeviceId(),
    pd: els.pdInput.value.trim(),
  };
  if (subscription !== undefined) {
    payload.subscription = subscription;
  }
  await fetch("/api/save-device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function subscribeWithWorker(subscription) {
  const base = pushWorkerBase();
  if (!base) {
    throw new Error("尚未設定 Cloudflare Worker 網址。");
  }
  const response = await fetch(`${base}/api/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription }),
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || "訂閱失敗");
  }
}

async function getVapidPublicKey() {
  const base = pushWorkerBase();
  const response = await fetch(base ? `${base}/api/vapid-public-key` : "/api/vapid-public-key");
  const payload = await response.json();
  if (!payload.ok) throw new Error("讀取推播金鑰失敗");
  return payload.publicKey;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("這個瀏覽器不支援背景通知。");
  }
  return navigator.serviceWorker.register("../service-worker.js");
}

function parseVisaDate(value) {
  const text = String(value || "").trim().toUpperCase();
  const bulletin = text.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  if (bulletin) {
    const year = Number(bulletin[3]);
    const fullYear = year < 70 ? 2000 + year : 1900 + year;
    const month = monthMap[bulletin[2]];
    if (month === undefined) return null;
    return new Date(Date.UTC(fullYear, month, Number(bulletin[1])));
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }

  return null;
}

function toIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDuration(days) {
  const absoluteDays = Math.abs(days);
  const months = Math.round((absoluteDays / 30.4375) * 10) / 10;
  return `${absoluteDays} 天，約 ${months} 個月`;
}

function updatePdResult() {
  const pdText = els.pdInput.value.trim();
  const cutoffText = state.current?.eb3_all_chargeability_final_action_date;
  if (!pdText) {
    els.pdResult.textContent = "尚未輸入 PD。";
    return;
  }

  const pdDate = parseVisaDate(pdText);
  const cutoffDate = parseVisaDate(cutoffText);
  if (!pdDate) {
    els.pdResult.textContent = "PD 格式看不懂，請用 01AUG24 或 2024-08-01。";
    return;
  }
  if (!cutoffDate) {
    els.pdResult.textContent = "目前公布值不是日期，暫時無法計算差距。";
    return;
  }

  const diffDays = Math.round((cutoffDate - pdDate) / 86400000);
  if (diffDays > 0) {
    els.pdResult.textContent = `你的 PD 已早於最新公布日期 ${cutoffText}，排期看起來已經到了。恭喜，這一步很不容易。`;
  } else if (diffDays === 0) {
    els.pdResult.textContent = `你的 PD 剛好等於最新公布日期 ${cutoffText}。官方文字通常要求早於公布日期，建議再確認當月指引。`;
  } else {
    els.pdResult.textContent = `你的 PD 距離最新公布日期 ${cutoffText} 還差 ${formatDuration(diffDays)}。我們繼續盯著。`;
  }
}

function encouragementFor(movement) {
  const kind = movement?.kind || "same";
  if (kind === "advanced") {
    return {
      tone: "advanced",
      kicker: "排期前進",
      title: "恭喜！又往前一步",
      text: "恭喜又往前一步，離目標越來越近了。",
    };
  }
  if (kind === "retrogressed") {
    return {
      tone: "retrogressed",
      kicker: "排期倒退",
      title: "先深呼吸，我們還在隊伍裡",
      text: "排程倒退真的很讓人沮喪，至少我們還在隊伍裡，再撐一下，很快就會有好消息。",
    };
  }
  return {
    tone: "same",
    kicker: "排期不變",
    title: "排程維持住了！",
    text: "我們繼續保持希望。",
  };
}

function launchFireworks() {
  els.fireworks.innerHTML = "";
  els.fireworks.classList.add("active");
  const colors = ["#ffcf33", "#ff6b6b", "#38bdf8", "#22c55e", "#a855f7"];

  for (let i = 0; i < 34; i += 1) {
    const spark = document.createElement("span");
    spark.style.left = `${15 + Math.random() * 70}%`;
    spark.style.top = `${12 + Math.random() * 34}%`;
    spark.style.setProperty("--x", `${(Math.random() - 0.5) * 280}px`);
    spark.style.setProperty("--y", `${80 + Math.random() * 220}px`);
    spark.style.background = colors[i % colors.length];
    spark.style.animationDelay = `${Math.random() * 0.35}s`;
    els.fireworks.appendChild(spark);
  }

  window.setTimeout(() => {
    els.fireworks.classList.remove("active");
    els.fireworks.innerHTML = "";
  }, 2600);
}

function renderMood(movement, shouldCelebrate = false) {
  const mood = encouragementFor(movement);
  document.body.dataset.mood = mood.tone;
  els.messageKicker.textContent = mood.kicker;
  els.encouragementTitle.textContent = mood.title;
  els.encouragementText.textContent = mood.text;
  if (mood.tone === "advanced" && shouldCelebrate) {
    launchFireworks();
  }
}

function renderState(current, { celebrate = false } = {}) {
  if (!current) return;
  state.current = current;
  els.dateValue.textContent = current.eb3_all_chargeability_final_action_date || "--";
  els.movementValue.textContent = current.movement_from_previous_bulletin?.label || "--";
  if (current.previous_bulletin_source_url) {
    els.previousSourceLink.href = current.previous_bulletin_source_url;
    const previousValue = current.previous_bulletin_eb3_all_chargeability_final_action_date;
    const previousLabel = current.previous_bulletin || "上個月公告";
    els.previousSourceLink.textContent = previousValue
      ? `上月：${previousValue} · ${previousLabel}`
      : `比較基準：${previousLabel}`;
    els.previousSourceLink.hidden = false;
  } else {
    els.previousSourceLink.hidden = true;
  }
  els.bulletinValue.textContent = current.bulletin || "--";
  els.checkedValue.textContent = `上次檢查更新時間：${formatChecked(current.checked_at)}`;
  if (current.source_url) {
    els.sourceLink.href = current.source_url;
  }
  renderMood(current.movement_from_previous_bulletin, celebrate);
  updatePdResult();
}

function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  new Notification(title, {
    body,
    tag: "visa-bulletin-eb3",
  });
}

async function loadStatus() {
  if (isStaticSite()) {
    state.backendAvailable = false;
    await loadStaticStatus();
    return;
  }

  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error("沒有後端服務");
    const payload = await response.json();
    if (payload.ok) {
      state.backendAvailable = true;
      renderState(payload.state);
      return;
    }
    throw new Error("讀取後端狀態失敗");
  } catch {
    state.backendAvailable = false;
    await loadStaticStatus();
  }
}

async function loadStaticStatus() {
  const stateUrl = new URL("../visa_bulletin_state.json", window.location.href);
  stateUrl.searchParams.set("v", Date.now().toString());
  let current;
  try {
    const response = await fetch(stateUrl);
    if (!response.ok) throw new Error(`讀取資料檔失敗：${response.status}`);
    current = await response.json();
  } catch {
    current = loadInitialState();
  }
  renderState(current);
  els.noticeText.textContent = "目前是免費網頁版：可查看最新資料與儲存自己的 PD。";
  setStatus("網頁版", "idle");
}

function loadInitialState() {
  const embedded = document.querySelector("#initialVisaState");
  if (!embedded?.textContent) {
    throw new Error("找不到內建公告資料。");
  }
  return JSON.parse(embedded.textContent);
}

async function checkNow({ notifyBrowser = true } = {}) {
  if (state.checking) return;
  if (!state.backendAvailable) {
    await loadStatus();
    els.noticeText.textContent = "GitHub Pages 免費版無法即時執行後台檢查；最新資料會由自動流程更新到這個頁面。";
    return;
  }
  state.checking = true;
  if (els.checkNow) els.checkNow.disabled = true;
  setStatus("檢查中", "busy");

  try {
    const response = await fetch("/api/check");
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "檢查失敗");

    renderState(payload.state, {
      celebrate: payload.notice?.movement?.kind === "advanced",
    });
    els.noticeText.textContent = payload.notice.message;

    if (payload.notice.notify && notifyBrowser) {
      notify(payload.notice.title, payload.notice.message);
    }
    setStatus(payload.notice.notify ? "有更新" : "無變化", payload.notice.notify ? "updated" : "idle");
  } catch (error) {
    els.noticeText.textContent = `檢查失敗：${error.message}`;
    setStatus("錯誤", "error");
  } finally {
    state.checking = false;
    if (els.checkNow) els.checkNow.disabled = false;
  }
}

async function enableNotifications() {
  if (window.location.protocol === "file:") {
    els.noticeText.textContent = "瀏覽器通知需要用正式 HTTPS 網址開啟，請使用 GitHub Pages 網站後再按開啟通知。";
    return;
  }

  if (!state.backendAvailable && !pushWorkerBase()) {
    els.noticeText.textContent = `手機通知設定：\n1. 手機安裝 ntfy App。\n2. 新增訂閱 topic：${NTFY_TOPIC}\n3. 朋友也訂閱同一個 topic，就會一起收到每月公告通知。\n\n訂閱網址：${NTFY_URL}`;
    window.open(NTFY_URL, "_blank", "noopener,noreferrer");
    return;
  }
  if (!("Notification" in window) || !("PushManager" in window)) {
    els.noticeText.textContent = "這個瀏覽器不支援手機推播通知。";
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    try {
      const registration = await registerServiceWorker();
      const publicKey = await getVapidPublicKey();
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      if (state.backendAvailable && !pushWorkerBase()) {
        await saveDevice({ subscription: subscription.toJSON() });
      } else {
        await subscribeWithWorker(subscription.toJSON());
      }
      notify("Visa Bulletin 監控已開啟", "這台裝置已完成通知訂閱。");
      els.noticeText.textContent = "通知已開啟。之後新月份公告或排期變動時，這台裝置會收到提醒。";
    } catch (error) {
      els.noticeText.textContent = `通知設定失敗：${error.message}`;
    }
  } else {
    els.noticeText.textContent = "尚未開啟通知權限。";
  }
}

els.checkNow?.addEventListener("click", () => checkNow());
els.enableNotifications?.addEventListener("click", enableNotifications);
els.pdForm.addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem(PD_STORAGE_KEY, els.pdInput.value.trim());
  updatePdResult();
  saveDevice().catch(() => {
    els.noticeText.textContent = "PD 已存在本機，但同步到通知後台失敗。";
  });
});
els.pdInput.addEventListener("input", updatePdResult);
els.pdInput.addEventListener("change", () => {
  const parsed = parseVisaDate(els.pdInput.value);
  if (parsed) {
    els.pdDatePicker.value = toIsoDate(parsed);
  }
});
els.pdDatePicker.addEventListener("change", () => {
  els.pdInput.value = els.pdDatePicker.value;
  localStorage.setItem(PD_STORAGE_KEY, els.pdInput.value.trim());
  updatePdResult();
  saveDevice().catch(() => {
    els.noticeText.textContent = "PD 已存在本機，但同步到通知後台失敗。";
  });
});

els.pdInput.value = localStorage.getItem(PD_STORAGE_KEY) || "";
{
  const savedPd = parseVisaDate(els.pdInput.value);
  if (savedPd) {
    els.pdDatePicker.value = toIsoDate(savedPd);
  }
}

loadStatus().catch(() => {
  els.noticeText.textContent = "讀取監控狀態失敗。";
});

registerServiceWorker().catch(() => {});
saveDevice().catch(() => {});

state.timer = window.setInterval(() => checkNow(), CHECK_INTERVAL_MS);
