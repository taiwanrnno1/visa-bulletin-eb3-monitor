const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const PD_STORAGE_KEY = "visaBulletinEb3PriorityDate";
const RECEIPT_STORAGE_KEY = "heimiCaseReceiptNumber";
const RECEIPT_PRIVACY_RESET_KEY = "heimiCaseReceiptPrivacyResetV1";
const DEVICE_ID_STORAGE_KEY = "visaBulletinEb3DeviceId";
const WORKER_BASE_STORAGE_KEY = "visaBulletinEb3WorkerBase";
const PUSH_WORKER_BASE = "https://visa-bulletin-eb3-push.t6213982-32d.workers.dev";
const NTFY_TOPIC = "visa-bulletin-eb3-taiwanrnno1";
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;
const PUBLIC_SITE_URL = "https://taiwanrnno1.github.io/visa-bulletin-eb3-monitor/";

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
  noticeText: document.querySelector("#noticeText"),
  checkNow: document.querySelector("#checkNow"),
  enableNotifications: document.querySelector("#enableNotifications"),
  openGuide: document.querySelector("#openGuide"),
  shareSite: document.querySelector("#shareSite"),
  guideModal: document.querySelector("#guideModal"),
  pdModal: document.querySelector("#pdModal"),
  pdModalText: document.querySelector("#pdModalText"),
  ntfyLink: document.querySelector("#ntfyLink"),
  sourceLink: document.querySelector("#sourceLink"),
  messagePanel: document.querySelector("#messagePanel"),
  messageKicker: document.querySelector("#messageKicker"),
  encouragementTitle: document.querySelector("#encouragementTitle"),
  encouragementText: document.querySelector("#encouragementText"),
  fireworks: document.querySelector("#fireworks"),
  pdForm: document.querySelector("#pdForm"),
  pdInput: document.querySelector("#pdInput"),
  openPdCalendar: document.querySelector("#openPdCalendar"),
  pdDatePicker: document.querySelector("#pdDatePicker"),
  pdResult: document.querySelector("#pdResult"),
  caseForm: document.querySelector("#caseForm"),
  receiptInput: document.querySelector("#receiptInput"),
  openCaseStatus: document.querySelector("#openCaseStatus"),
  caseNote: document.querySelector("#caseNote"),
  progressBadge: document.querySelector("#progressBadge"),
  waitProgressFill: document.querySelector("#waitProgressFill"),
  progressCat: document.querySelector("#progressCat"),
  waitedDays: document.querySelector("#waitedDays"),
  gapDays: document.querySelector("#gapDays"),
  progressText: document.querySelector("#progressText"),
  sharePreview: document.querySelector("#sharePreview"),
  copyShareCard: document.querySelector("#copyShareCard"),
  shareStatus: document.querySelector("#shareStatus"),
  historyChart: document.querySelector("#historyChart"),
  historySummary: document.querySelector("#historySummary"),
  historyInsight: document.querySelector("#historyInsight"),
  historyHighlights: document.querySelector("#historyHighlights"),
  historySourceLink: document.querySelector("#historySourceLink"),
};

function setStatus(text, kind = "idle") {
  if (!els.connectionStatus) return;
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

function normalizeReceiptNumber(value) {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

function isValidReceiptNumber(value) {
  return /^[A-Z]{3}\d{10}$/.test(normalizeReceiptNumber(value));
}

function caseStatusUrl(receiptNumber) {
  if (!normalizeReceiptNumber(receiptNumber)) {
    return "https://egov.uscis.gov/";
  }
  const url = new URL("https://egov.uscis.gov/casestatus/mycasestatus.do");
  url.searchParams.set("appReceiptNum", normalizeReceiptNumber(receiptNumber));
  return url.toString();
}

function formatDuration(days) {
  const absoluteDays = Math.abs(days);
  const months = Math.round((absoluteDays / 30.4375) * 10) / 10;
  return `${absoluteDays} 天，約 ${months.toFixed(1)} 個月`;
}

function formatBulletinDateReadable(value) {
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
  if (!match) return text || "--";
  return `${match[1]} ${match[2]} ${match[3]}`;
}

function daysBetween(firstDate, secondDate) {
  return Math.round((secondDate - firstDate) / 86400000);
}

function getTodayUtc() {
  const today = new Date();
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
}

function buildHistoryItems(current) {
  const items = [];
  if (Array.isArray(current?.history)) {
    current.history.forEach((item, index) => {
      const dateText = item.eb3_all_chargeability_final_action_date || item.value;
      if (parseVisaDate(dateText)) {
        items.push({
          bulletin: item.bulletin || item.label || "Visa Bulletin",
          value: dateText,
          url: item.source_url || item.url || "",
          year: Number(item.year) || 0,
          month: Number(item.month) || 0,
          order: index,
        });
      }
    });
  }

  if (items.length === 0 && current?.previous_bulletin_eb3_all_chargeability_final_action_date) {
    items.push({
      bulletin: current.previous_bulletin || "上個月",
      value: current.previous_bulletin_eb3_all_chargeability_final_action_date,
      url: current.previous_bulletin_source_url || "",
      year: 0,
      month: 0,
      order: 0,
    });
  }

  if (current?.eb3_all_chargeability_final_action_date) {
    const alreadyIncluded = items.some((item) => item.bulletin === current.bulletin && item.value === current.eb3_all_chargeability_final_action_date);
    if (!alreadyIncluded) {
      items.push({
        bulletin: current.bulletin || "本月",
        value: current.eb3_all_chargeability_final_action_date,
        url: current.source_url || "",
        year: 9999,
        month: 99,
        order: 1,
      });
    }
  }

  return items
    .filter((item) => parseVisaDate(item.value))
    .sort((a, b) => (a.year - b.year) || (a.month - b.month) || (a.order - b.order));
}

function bulletinShortName(label) {
  const match = String(label || "").match(/Visa Bulletin For ([A-Za-z]+) (\d{4})/i);
  if (!match) return String(label || "公告月份");
  return `${match[1].slice(0, 3)} ${match[2]}`;
}

function bulletinMonthLabel(item) {
  if (item?.year && item?.month) {
    return `${item.year}/${String(item.month).padStart(2, "0")} 公布`;
  }
  return `${bulletinShortName(item?.bulletin)} 公布`;
}

function historyPointLabel(item) {
  return {
    bulletin: bulletinMonthLabel(item),
    pd: item.value,
  };
}

function classifyHistoryPoint(items, index) {
  if (index === 0) return "start";
  const previous = parseVisaDate(items[index - 1].value);
  const current = parseVisaDate(items[index].value);
  const delta = daysBetween(previous, current);
  if (delta > 0) return "advanced";
  if (delta < 0) return "retrogressed";
  return "same";
}

function importantHistoryIndexes(items) {
  if (items.length <= 4) return items.map((_, index) => index);
  const candidates = new Map();
  const moves = [];
  let sameRunStart = null;
  const sameRuns = [];

  const addCandidate = (index, priority) => {
    const current = candidates.get(index);
    if (current === undefined || priority < current) {
      candidates.set(index, priority);
    }
  };

  addCandidate(0, 0);
  addCandidate(items.length - 1, 0);

  for (let index = 1; index < items.length; index += 1) {
    const delta = daysBetween(parseVisaDate(items[index - 1].value), parseVisaDate(items[index].value));
    moves.push({ index, delta });

    if (delta < 0) {
      addCandidate(index, 1);
    }

    if (delta === 0 && sameRunStart === null) {
      sameRunStart = index - 1;
    }

    if (delta !== 0 && sameRunStart !== null) {
      const sameRunEnd = index - 1;
      if (sameRunEnd - sameRunStart >= 1) {
        sameRuns.push({
          start: sameRunStart,
          end: sameRunEnd,
          next: index,
          length: sameRunEnd - sameRunStart + 1,
        });
      }
      sameRunStart = null;
    }
  }

  if (sameRunStart !== null && items.length - 1 - sameRunStart >= 1) {
    sameRuns.push({
      start: sameRunStart,
      end: items.length - 1,
      next: items.length - 1,
      length: items.length - sameRunStart,
    });
  }

  moves
    .filter((move) => move.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
    .forEach((move) => addCandidate(move.index, 2));

  sameRuns
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .forEach((run) => {
      addCandidate(run.start, 3);
      addCandidate(run.end, 4);
      addCandidate(run.next, 3);
    });

  return [...candidates.entries()]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .slice(0, 8)
    .map(([index]) => index)
    .sort((a, b) => a - b);
}

function buildHistoryInsight(items) {
  if (items.length < 2) return "目前資料還不夠，黑咪先幫你守著下一次更新喵～";
  let advanced = 0;
  let same = 0;
  let retrogressed = 0;
  let biggestMove = { days: 0, index: 1 };

  for (let i = 1; i < items.length; i += 1) {
    const delta = daysBetween(parseVisaDate(items[i - 1].value), parseVisaDate(items[i].value));
    if (delta > 0) advanced += 1;
    if (delta === 0) same += 1;
    if (delta < 0) retrogressed += 1;
    if (Math.abs(delta) > Math.abs(biggestMove.days)) {
      biggestMove = { days: delta, index: i };
    }
  }

  return `每個標籤上排是公布月份，下排是當月表 A PD 更新到哪一天。近兩年：前進 ${advanced} 次、維持 ${same} 次、倒退 ${retrogressed} 次喵～`;
}

function buildHistoryHighlights(items) {
  if (items.length < 2) return [];
  const moves = [];
  let sameRunStart = null;
  const sameRuns = [];

  for (let index = 1; index < items.length; index += 1) {
    const delta = daysBetween(parseVisaDate(items[index - 1].value), parseVisaDate(items[index].value));
    moves.push({ index, delta });
    if (delta === 0 && sameRunStart === null) sameRunStart = index - 1;
    if (delta !== 0 && sameRunStart !== null) {
      sameRuns.push({ start: sameRunStart, end: index - 1, length: index - sameRunStart });
      sameRunStart = null;
    }
  }
  if (sameRunStart !== null) {
    sameRuns.push({ start: sameRunStart, end: items.length - 1, length: items.length - sameRunStart });
  }

  const biggestAdvance = moves.filter((move) => move.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const biggestRetro = moves.filter((move) => move.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  const longestPause = sameRuns.sort((a, b) => b.length - a.length)[0];
  const latest = items[items.length - 1];
  const cards = [];

  if (biggestAdvance) {
    cards.push({
      icon: "🚀",
      title: "最大前進",
      text: `${bulletinMonthLabel(items[biggestAdvance.index])} · ${items[biggestAdvance.index].value}`,
    });
  }
  if (biggestRetro) {
    cards.push({
      icon: "⬅️",
      title: "明顯倒退",
      text: `${bulletinMonthLabel(items[biggestRetro.index])} · ${items[biggestRetro.index].value}`,
    });
  }
  if (longestPause) {
    cards.push({
      icon: "⏸️",
      title: "最長停滯",
      text: `${bulletinShortName(items[longestPause.start].bulletin)} 到 ${bulletinShortName(items[longestPause.end].bulletin)}`,
    });
  }
  cards.push({
    icon: "🐱",
    title: "本月位置",
    text: `${bulletinMonthLabel(latest)} · ${latest.value}`,
  });

  return cards.slice(0, 4);
}

function buildShareText(current) {
  if (!current) return "黑咪快報正在整理本月資料喵～";
  const movement = current.movement_from_previous_bulletin || {};
  const kind = movement.kind || "same";
  const currentDate = formatBulletinDateReadable(current.eb3_all_chargeability_final_action_date);
  const previousDate = formatBulletinDateReadable(current.previous_bulletin_eb3_all_chargeability_final_action_date);
  const footer = `\n\n🔗 黑咪快報：${PUBLIC_SITE_URL}`;

  if (kind === "advanced") {
    return `🐱 好消息！EB-3 排期前進啦！喵～\n\n📅 表 A 本月最新日期：${currentDate}\n🚀 較上個月推進 ${formatDuration(movement.days || 0)}\n📍 上個月數值：${previousDate}\n🐾 快來看看你的 Priority Date 是不是更接近了！${footer}`;
  }

  if (kind === "retrogressed") {
    return `🐱 EB-3 排期更新！本月出現倒退喵～\n\n📅 表 A 最新日期：${currentDate}\n⬅️ 較上個月倒退 ${formatDuration(movement.days || 0)}\n📍 上個月日期：${previousDate}\n🐾 別灰心，下個月再持續關注最新動態！${footer}`;
  }

  return `🐱 EB-3 排期更新！本月維持不變喵～\n\n📅 表 A 最新日期仍為 ${currentDate}\n⏸️ 與上個月相比沒有前進也沒有倒退\n📍 上個月日期：${previousDate}\n耐心等待，下個月再一起關注喵～ 🐾${footer}`;
}

function renderShareCard(current) {
  if (!els.sharePreview) return;
  els.sharePreview.textContent = buildShareText(current);
}

function renderProgressCard() {
  if (!els.waitProgressFill) return;
  const pdDate = parseVisaDate(els.pdInput.value);
  const cutoffDate = parseVisaDate(state.current?.eb3_all_chargeability_final_action_date);
  const today = getTodayUtc();

  if (!pdDate || !cutoffDate) {
    els.progressBadge.textContent = "尚未輸入 PD";
    els.waitProgressFill.style.width = "8%";
    els.progressCat.style.left = "8%";
    els.waitedDays.textContent = "已等待：--";
    els.gapDays.textContent = "距離本月：--";
    els.progressText.textContent = "輸入 Priority Date 後，黑咪會幫你估算等待時間與離本月公布日期還差多久喵～";
    return;
  }

  const waited = Math.max(0, daysBetween(pdDate, today));
  const diffToCutoff = daysBetween(cutoffDate, pdDate);
  if (diffToCutoff <= 0) {
    els.progressBadge.textContent = "本月已到或已超過";
    els.waitProgressFill.style.width = "100%";
    els.progressCat.style.left = "96%";
    els.waitedDays.textContent = `已等待：${formatDuration(waited)}`;
    els.gapDays.textContent = "距離本月：已到達";
    els.progressText.textContent = "黑咪敲碗！你的 Priority Date 已經早於或等於本月公布日期，請搭配官方指引與律師確認下一步喵～";
    return;
  }

  const roughTotal = Math.max(1, waited + diffToCutoff);
  const percent = Math.max(6, Math.min(96, Math.round((waited / roughTotal) * 100)));
  els.progressBadge.textContent = `${percent}% 旅程感`;
  els.waitProgressFill.style.width = `${percent}%`;
  els.progressCat.style.left = `${percent}%`;
  els.waitedDays.textContent = `已等待：約 ${formatDuration(waited)}`;
  els.gapDays.textContent = `距離本月：${formatDuration(diffToCutoff)}`;
  els.progressText.textContent = "這是黑咪用目前公布日期估算的等待旅程感，不是官方預測；但很適合每月追蹤自己的距離喵～";
}

function renderHistoryChart(current) {
  if (!els.historyChart) return;
  const items = buildHistoryItems(current);
  els.historyChart.innerHTML = "";
  if (els.historyHighlights) els.historyHighlights.innerHTML = "";

  if (items.length === 0) {
    els.historySummary.textContent = "目前還沒有可畫圖的資料";
    els.historyInsight.textContent = "等下一次官方公告後，黑咪再幫你整理走勢喵～";
    return;
  }

  const dates = items.map((item) => parseVisaDate(item.value).getTime());
  const min = Math.min(...dates);
  const max = Math.max(...dates);
  const range = Math.max(1, max - min);
  const chartWidth = 640;
  const chartHeight = 260;
  const pad = 86;
  const usableWidth = chartWidth - pad * 2;
  const usableHeight = chartHeight - pad * 2;

  const points = items.map((item, index) => {
    const x = items.length === 1 ? chartWidth / 2 : pad + (index / (items.length - 1)) * usableWidth;
    const y = pad + (1 - ((parseVisaDate(item.value).getTime() - min) / range)) * usableHeight;
    return { ...item, x, y };
  });

  const grid = document.createElementNS("http://www.w3.org/2000/svg", "g");
  grid.setAttribute("class", "chart-grid");
  for (let i = 0; i < 5; i += 1) {
    const y = pad + (i / 4) * usableHeight;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", pad);
    line.setAttribute("x2", chartWidth - pad);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    grid.appendChild(line);
  }
  els.historyChart.appendChild(grid);

  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  area.setAttribute("class", "chart-area");
  const areaPoints = points.map((point) => `${point.x},${point.y}`).join(" L ");
  area.setAttribute("d", `M ${points[0].x},${chartHeight - pad} L ${areaPoints} L ${points[points.length - 1].x},${chartHeight - pad} Z`);
  els.historyChart.appendChild(area);

  if (points.length > 1) {
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("class", "chart-line");
    polyline.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
    els.historyChart.appendChild(polyline);
  }

  const importantIndexes = importantHistoryIndexes(items);
  const important = new Set(importantIndexes);
  const topLabelTracks = [24, 62];
  const bottomLabelTracks = [chartHeight - 24, chartHeight - 62];
  const placedLabels = [];
  const labelWidth = 104;
  const labelHeight = 30;
  const labelGap = 112;
  points.forEach((point, index) => {
    const kind = classifyHistoryPoint(items, index);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("class", `chart-dot ${kind} ${important.has(index) ? "important" : ""}`);
    dot.setAttribute("cx", point.x);
    dot.setAttribute("cy", point.y);
    dot.setAttribute("r", important.has(index) ? "7" : "3.5");
    els.historyChart.appendChild(dot);

    if (important.has(index)) {
      const preferredTracks = point.y > chartHeight / 2
        ? bottomLabelTracks.concat(topLabelTracks)
        : topLabelTracks.concat(bottomLabelTracks);
      const trackY = preferredTracks.find((track) => (
        placedLabels.every((placed) => placed.y !== track || Math.abs(placed.x - point.x) > labelGap)
      )) || preferredTracks[index % preferredTracks.length];
      const labelX = Math.max(labelWidth / 2 + 8, Math.min(chartWidth - labelWidth / 2 - 8, point.x));
      placedLabels.push({ x: labelX, y: trackY });

      const connector = document.createElementNS("http://www.w3.org/2000/svg", "line");
      connector.setAttribute("class", `chart-label-connector ${kind}`);
      connector.setAttribute("x1", point.x);
      connector.setAttribute("y1", point.y);
      connector.setAttribute("x2", labelX);
      connector.setAttribute("y2", trackY);
      els.historyChart.insertBefore(connector, dot);

      const labelGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      labelGroup.setAttribute("class", `chart-label-card ${kind}`);
      labelGroup.setAttribute("transform", `translate(${labelX - labelWidth / 2}, ${trackY - labelHeight / 2})`);

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", labelWidth);
      rect.setAttribute("height", labelHeight);
      rect.setAttribute("rx", "9");
      rect.setAttribute("ry", "9");
      labelGroup.appendChild(rect);

      const labelText = historyPointLabel(point);
      const bulletinText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      bulletinText.setAttribute("class", "chart-label-month");
      bulletinText.setAttribute("x", labelWidth / 2);
      bulletinText.setAttribute("y", "13");
      bulletinText.setAttribute("text-anchor", "middle");
      bulletinText.textContent = labelText.bulletin;
      labelGroup.appendChild(bulletinText);

      const pdText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      pdText.setAttribute("class", "chart-label-pd");
      pdText.setAttribute("x", labelWidth / 2);
      pdText.setAttribute("y", "25");
      pdText.setAttribute("text-anchor", "middle");
      pdText.textContent = labelText.pd;
      labelGroup.appendChild(pdText);

      els.historyChart.appendChild(labelGroup);
    }
  });

  els.historySummary.textContent = items.length > 1
    ? `近兩年共 ${items.length} 個月份`
    : "目前先顯示本月資料";
  els.historyInsight.textContent = buildHistoryInsight(items);
  if (current?.source_url) {
    els.historySourceLink.href = "https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html";
  }

  buildHistoryHighlights(items).forEach((card) => {
    const item = document.createElement("article");
    item.className = "history-highlight";
    item.innerHTML = `<span>${card.icon}</span><strong>${card.title}</strong><small>${card.text}</small>`;
    els.historyHighlights?.appendChild(item);
  });
}

function buildPdMessage() {
  const pdText = els.pdInput.value.trim();
  const cutoffText = state.current?.eb3_all_chargeability_final_action_date;
  if (!pdText) {
    return "";
  }

  const pdDate = parseVisaDate(pdText);
  const cutoffDate = parseVisaDate(cutoffText);
  if (!pdDate) {
    return "PD 格式看不懂，請用 01AUG24 或 2024-08-01。";
  }
  if (!cutoffDate) {
    return "目前公布值不是日期，暫時無法計算差距。";
  }

  const diffDays = Math.round((cutoffDate - pdDate) / 86400000);
  if (diffDays > 0) {
    return `🐾 你的 PD 已早於最新公布日期 ${cutoffText}，排期看起來已經到了。恭喜喵～這一步很不容易。`;
  }
  if (diffDays === 0) {
    return `📅 你的 PD 剛好等於最新公布日期 ${cutoffText}。官方文字通常要求早於公布日期，建議再確認當月指引喵～`;
  }
  return `🐾 你的 PD 距離最新公布日期 ${cutoffText} 還差 ${formatDuration(diffDays)}。黑咪陪你繼續盯著喵～`;
}

function updatePdResult() {
  const message = buildPdMessage();
  els.pdResult.textContent = message;
  els.pdResult.hidden = !message;
  return message;
}

function encouragementFor(movement) {
  const kind = movement?.kind || "same";
  if (kind === "advanced") {
    return {
      tone: "advanced",
      kicker: "🚀 排期前進",
      title: "恭喜！又往前一步喵～",
      text: "恭喜又往前一步，離目標越來越近了。黑咪幫你放煙火！",
    };
  }
  if (kind === "retrogressed") {
    return {
      tone: "retrogressed",
      kicker: "⬅️ 排期倒退",
      title: "先深呼吸，我們還在隊伍裡喵",
      text: "排期倒退真的很讓人沮喪，至少我們還在隊伍裡。黑咪陪你再撐一下，等下個好消息。",
    };
  }
  return {
    tone: "same",
    kicker: "⏸️ 排期不變",
    title: "排期維持住了！",
    text: "沒有前進也沒有倒退，黑咪先按住希望，陪你等下個月喵～",
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
  if (current.source_url) {
    els.dateValue.href = current.source_url;
    els.sourceLink.href = current.source_url;
  }
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
  renderMood(current.movement_from_previous_bulletin, celebrate);
  updatePdResult();
  renderProgressCard();
  renderShareCard(current);
  renderHistoryChart(current);
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

function openGuide() {
  els.guideModal?.classList.add("open");
  els.guideModal?.setAttribute("aria-hidden", "false");
}

function closeGuide() {
  els.guideModal?.classList.remove("open");
  els.guideModal?.setAttribute("aria-hidden", "true");
}

async function shareSiteUrl() {
  const originalLabel = els.shareSite?.textContent || "🔗 分享 / 複製網址";
  const shareData = {
    title: "黑咪快報 EB-3 台灣排期",
    text: "黑咪快報幫你看 EB-3 表 A 台灣排期、算 Priority Date，還能看本月懶人包喵～",
    url: PUBLIC_SITE_URL,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await copyText(PUBLIC_SITE_URL);
    flashShareButton("✅ 已複製網址");
    if (els.shareStatus) {
      els.shareStatus.textContent = "已複製黑咪快報網址，可以轉傳給朋友喵～";
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    try {
      await copyText(PUBLIC_SITE_URL);
      flashShareButton("✅ 已複製網址");
      if (els.shareStatus) {
        els.shareStatus.textContent = "已複製黑咪快報網址，可以轉傳給朋友喵～";
      }
    } catch {
      if (els.shareStatus) {
        els.shareStatus.textContent = `請手動複製網址：${PUBLIC_SITE_URL}`;
      }
    }
  }

  function flashShareButton(label) {
    if (!els.shareSite) return;
    els.shareSite.textContent = label;
    window.setTimeout(() => {
      els.shareSite.textContent = originalLabel;
    }, 1800);
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

function openPdModal(message) {
  if (!message) return;
  els.pdModalText.textContent = message;
  els.pdModal?.classList.add("open");
  els.pdModal?.setAttribute("aria-hidden", "false");
}

function closePdModal() {
  els.pdModal?.classList.remove("open");
  els.pdModal?.setAttribute("aria-hidden", "true");
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
  els.noticeText.textContent = "🐱 目前可查看最新資料與儲存自己的 PD。黑咪會持續巡邏喵～";
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
    els.noticeText.textContent = "🐾 GitHub Pages 免費版無法即時執行後台檢查；最新資料會由自動流程更新到這個頁面。";
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
      notify("黑咪快報已開啟", "這台裝置已完成通知訂閱喵～");
      els.noticeText.textContent = "📣 通知已開啟。之後新月份公告或排期變動時，這台裝置會收到黑咪提醒喵～";
    } catch (error) {
      els.noticeText.textContent = `通知設定失敗：${error.message}`;
    }
  } else {
    els.noticeText.textContent = "尚未開啟通知權限。";
  }
}

els.checkNow?.addEventListener("click", () => checkNow());
els.enableNotifications?.addEventListener("click", enableNotifications);
els.openGuide?.addEventListener("click", openGuide);
els.shareSite?.addEventListener("click", shareSiteUrl);
document.querySelectorAll("[data-close-guide]").forEach((item) => {
  item.addEventListener("click", closeGuide);
});
document.querySelectorAll("[data-close-pd-modal]").forEach((item) => {
  item.addEventListener("click", closePdModal);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeGuide();
    closePdModal();
  }
});
els.pdForm.addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem(PD_STORAGE_KEY, els.pdInput.value.trim());
  openPdModal(updatePdResult());
  renderProgressCard();
  saveDevice().catch(() => {
    els.noticeText.textContent = "PD 已存在本機，但同步到通知後台失敗。";
  });
});
els.pdInput.addEventListener("input", () => {
  if (!els.pdInput.value.trim()) {
    updatePdResult();
    return;
  }
  if (parseVisaDate(els.pdInput.value)) {
    updatePdResult();
    renderProgressCard();
  }
});
els.pdInput.addEventListener("change", () => {
  const parsed = parseVisaDate(els.pdInput.value);
  if (parsed) {
    els.pdDatePicker.value = toIsoDate(parsed);
  }
  renderProgressCard();
});
els.openPdCalendar?.addEventListener("click", () => {
  if (typeof els.pdDatePicker.showPicker === "function") {
    els.pdDatePicker.showPicker();
    return;
  }
  els.pdDatePicker.focus();
  els.pdDatePicker.click();
});
els.pdDatePicker.addEventListener("change", () => {
  els.pdInput.value = els.pdDatePicker.value;
  localStorage.setItem(PD_STORAGE_KEY, els.pdInput.value.trim());
  openPdModal(updatePdResult());
  renderProgressCard();
  saveDevice().catch(() => {
    els.noticeText.textContent = "PD 已存在本機，但同步到通知後台失敗。";
  });
});

els.caseForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const receiptNumber = normalizeReceiptNumber(els.receiptInput.value);
  if (!isValidReceiptNumber(receiptNumber)) {
    els.caseNote.textContent = "Receipt Number 格式看起來不對喵～通常是 3 個英文字母加 10 個數字，例如 EAC1234567890。";
    return;
  }
  els.receiptInput.value = receiptNumber;
  localStorage.setItem(RECEIPT_STORAGE_KEY, receiptNumber);
  els.caseNote.textContent = "已儲存在這台裝置。Receipt Number 不會送到黑咪快報後台喵～需要查詢時請按官方查詢。";
});

els.openCaseStatus?.addEventListener("click", () => {
  const receiptNumber = normalizeReceiptNumber(els.receiptInput.value || localStorage.getItem(RECEIPT_STORAGE_KEY));
  if (receiptNumber && !isValidReceiptNumber(receiptNumber)) {
    els.caseNote.textContent = "Receipt Number 格式看起來不完整；黑咪先幫你開官方查詢頁，你也可以在官方頁手動輸入。";
    window.open(caseStatusUrl(""), "_blank", "noopener,noreferrer");
    return;
  }

  if (receiptNumber) {
    els.receiptInput.value = receiptNumber;
    localStorage.setItem(RECEIPT_STORAGE_KEY, receiptNumber);
  }
  window.open(caseStatusUrl(receiptNumber), "_blank", "noopener,noreferrer");
  els.caseNote.textContent = receiptNumber
    ? "已開啟 USCIS 官方 Case Status。若沒有自動帶入，請在官方頁貼上你本機儲存的 Receipt Number。"
    : "已開啟 USCIS 官方查詢頁。Receipt Number 是選填，需要時再讓黑咪幫你記在本機喵～";
});

els.copyShareCard?.addEventListener("click", async () => {
  const text = buildShareText(state.current);
  try {
    await copyText(text);
    els.shareStatus.textContent = "已複製分享文，黑咪幫你準備好了喵～";
  } catch {
    els.shareStatus.textContent = "瀏覽器暫時不給複製，請手動選取懶人包文字喵～";
  }
});

els.pdInput.value = localStorage.getItem(PD_STORAGE_KEY) || "";
if (els.receiptInput) {
  if (!localStorage.getItem(RECEIPT_PRIVACY_RESET_KEY)) {
    localStorage.removeItem(RECEIPT_STORAGE_KEY);
    localStorage.setItem(RECEIPT_PRIVACY_RESET_KEY, "done");
  }
  const savedReceiptNumber = normalizeReceiptNumber(localStorage.getItem(RECEIPT_STORAGE_KEY));
  const legacyPrefix = String.fromCharCode(73, 79, 69);
  if (savedReceiptNumber.startsWith(legacyPrefix)) {
    localStorage.removeItem(RECEIPT_STORAGE_KEY);
    els.receiptInput.value = "";
  } else {
    els.receiptInput.value = savedReceiptNumber || "";
  }
}
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
