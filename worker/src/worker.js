const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/vapid-public-key" && request.method === "GET") {
        return json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY }, env);
      }
      if (url.pathname === "/api/subscribe" && request.method === "POST") {
        return subscribe(request, env);
      }
      if (url.pathname === "/api/broadcast" && request.method === "POST") {
        return broadcast(request, env);
      }
      if (url.pathname === "/api/test" && request.method === "POST") {
        return testPush(request, env);
      }
      if (url.pathname === "/api/case-status" && request.method === "POST") {
        return caseStatus(request, env);
      }
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true }, env);
      }
      return json({ ok: false, error: "Not found" }, env, 404);
    } catch (error) {
      return json({ ok: false, error: error.message || String(error) }, env, 500);
    }
  },
};

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(payload, env, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function subscribe(request, env) {
  const payload = await request.json();
  const subscription = payload.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return json({ ok: false, error: "Missing subscription" }, env, 400);
  }

  const key = await sha256Base64url(subscription.endpoint);
  await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify({
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    createdAt: new Date().toISOString(),
  }));
  return json({ ok: true, id: key }, env);
}

async function broadcast(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.BROADCAST_SECRET || auth !== `Bearer ${env.BROADCAST_SECRET}`) {
    return json({ ok: false, error: "Unauthorized" }, env, 401);
  }

  const payload = await request.json();
  const notice = payload.notice || {};
  const current = notice.current || {};
  const message = {
    title: String(notice.title || "Visa Bulletin EB-3 更新"),
    body: String(notice.message || "新的 Visa Bulletin 已公布。"),
    url: env.SITE_URL || "/",
    tag: "visa-bulletin-eb3",
    data: {
      bulletin: current.bulletin,
      cutoff: current.eb3_all_chargeability_final_action_date,
    },
  };

  return sendToAll(message, env);
}

async function testPush(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.BROADCAST_SECRET || auth !== `Bearer ${env.BROADCAST_SECRET}`) {
    return json({ ok: false, error: "Unauthorized" }, env, 401);
  }

  const message = {
    title: "Visa Bulletin 測試通知",
    body: "這是一則測試推播。正式公告出來時，也會像這樣跳出提醒。",
    url: env.SITE_URL || "/",
    tag: "visa-bulletin-eb3-test",
    data: { test: true },
  };
  return sendToAll(message, env);
}

async function caseStatus(request, env) {
  const payload = await request.json();
  const receiptNumber = normalizeReceiptNumber(payload.receiptNumber);
  if (!/^[A-Z]{3}\d{10}$/.test(receiptNumber)) {
    return json({ ok: false, error: "Receipt Number 格式不正確。" }, env, 400);
  }

  const officialUrl = `https://egov.uscis.gov/casestatus/mycasestatus.do?appReceiptNum=${encodeURIComponent(receiptNumber)}`;
  const response = await fetch(officialUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HeimiBulletin/1.0; +https://taiwanrnno1.github.io/visa-bulletin-eb3-monitor/)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  const html = await response.text();
  if (!response.ok) {
    return json({
      ok: false,
      error: `USCIS 官方目前回應 ${response.status}，請稍後再試或使用官方按鈕查詢。`,
      officialUrl,
    }, env, 502);
  }

  const parsed = parseCaseStatus(html);
  if (!parsed.title && !parsed.body) {
    return json({
      ok: false,
      error: "黑咪暫時讀不到 USCIS 結果，請使用官方按鈕確認。",
      officialUrl,
    }, env, 502);
  }

  return json({
    ok: true,
    receiptNumber,
    officialUrl,
    title: parsed.title,
    body: parsed.body,
    titleZh: translateCaseTitle(parsed.title),
    bodyZh: translateCaseBody(parsed.title, parsed.body, receiptNumber),
    checkedAt: new Date().toISOString(),
  }, env);
}

function normalizeReceiptNumber(value) {
  return String(value || "").replace(/[\s-]/g, "").toUpperCase();
}

function parseCaseStatus(html) {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? cleanHtml(titleMatch[1]) : "";
  const afterTitle = titleMatch ? html.slice(titleMatch.index + titleMatch[0].length) : html;
  const paragraphMatch = afterTitle.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const body = paragraphMatch ? cleanHtml(paragraphMatch[1]) : "";
  return { title, body };
}

function cleanHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function translateCaseTitle(title) {
  const text = String(title || "").toLowerCase();
  if (text.includes("still being processed")) return "案件仍在 USCIS 處理中";
  if (text.includes("case was approved")) return "案件已核准";
  if (text.includes("case was received")) return "案件已收到";
  if (text.includes("request for additional evidence")) return "USCIS 已發出補件通知";
  if (text.includes("case was denied")) return "案件已被拒絕";
  if (text.includes("case was transferred")) return "案件已轉移到其他辦公室";
  if (text.includes("card was mailed")) return "卡片已寄出";
  if (text.includes("name was updated")) return "案件姓名資訊已更新";
  return title || "USCIS 案件狀態";
}

function translateCaseBody(title, body, receiptNumber) {
  const titleText = String(title || "").toLowerCase();
  const dateMatch = String(body || "").match(/As of ([A-Za-z]+ \d{1,2}, \d{4})/i);
  const dateText = dateMatch ? formatEnglishDateZh(dateMatch[1]) : "USCIS 最新更新日";

  if (titleText.includes("still being processed")) {
    return `截至 ${dateText}，你的 I-140 案件仍在 USCIS 處理中。USCIS 目前不需要你提供其他資料；如果需要補充資訊，會再通知你。黑咪提醒：請仍以官方頁面文字為準喵～`;
  }
  if (titleText.includes("case was approved")) {
    return `好消息！USCIS 顯示這個案件已核准。請留意後續官方通知或律師/雇主消息喵～`;
  }
  if (titleText.includes("case was received")) {
    return `USCIS 顯示已收到這個案件，案件正在排隊處理中。黑咪會陪你一起等更新喵～`;
  }
  if (titleText.includes("request for additional evidence")) {
    return `USCIS 顯示已發出補件通知。請盡快與律師或雇主確認官方信件內容與期限喵～`;
  }
  if (titleText.includes("case was denied")) {
    return `USCIS 顯示案件已被拒絕。這很重要，請立即與律師或雇主確認下一步。黑咪抱抱你喵。`;
  }
  if (titleText.includes("case was transferred")) {
    return `USCIS 顯示案件已轉移到其他辦公室處理。通常是內部作業移轉，請以官方後續更新為準喵～`;
  }

  return `USCIS 顯示 Receipt Number ${receiptNumber} 的最新狀態為：「${title || "未提供標題"}」。黑咪暫時只能提供摘要翻譯，詳細內容請搭配官方頁面確認喵～`;
}

function formatEnglishDateZh(value) {
  const months = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const match = String(value || "").match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return value;
  const month = months[match[1].toLowerCase()];
  if (!month) return value;
  return `${match[3]}年${month}月${Number(match[2])}日`;
}

async function sendToAll(message, env) {
  let cursor;
  let sent = 0;
  let failed = 0;
  do {
    const listed = await env.PUSH_SUBSCRIPTIONS.list({ cursor });
    cursor = listed.cursor;
    await Promise.all(listed.keys.map(async (item) => {
      const raw = await env.PUSH_SUBSCRIPTIONS.get(item.name);
      if (!raw) return;
      const subscription = JSON.parse(raw);
      const result = await sendWebPush(subscription, message, env);
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
        if (result.remove) {
          await env.PUSH_SUBSCRIPTIONS.delete(item.name);
        }
      }
    }));
  } while (cursor);

  return json({ ok: true, sent, failed }, env);
}

async function sendWebPush(subscription, payload, env) {
  const body = JSON.stringify(payload);
  const encrypted = await encryptPayload(subscription, body);
  const jwt = await createVapidJwt(subscription.endpoint, env);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "2419200",
      "Urgency": "normal",
    },
    body: encrypted,
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    remove: response.status === 404 || response.status === 410,
    status: response.status,
  };
}

async function createVapidJwt(endpoint, env) {
  const privateJwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const aud = new URL(endpoint).origin;
  const header = base64urlJson({ typ: "JWT", alg: "ES256" });
  const claims = base64urlJson({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: env.VAPID_SUBJECT || "mailto:visa-bulletin-monitor@example.com",
  });
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput)
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

async function encryptPayload(subscription, payload) {
  const receiverPublic = base64urlToBytes(subscription.keys.p256dh);
  const authSecret = base64urlToBytes(subscription.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const senderKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", senderKeyPair.publicKey));
  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: receiverKey },
    senderKeyPair.privateKey,
    256
  ));

  const prkKey = await hmac(authSecret, sharedSecret);
  const keyInfo = concatBytes(
    encoder.encode("WebPush: info"),
    new Uint8Array([0]),
    receiverPublic,
    senderPublic,
    new Uint8Array([1])
  );
  const ikm = await hmac(prkKey, keyInfo);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concatBytes(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmac(prk, concatBytes(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0, 1])))).slice(0, 12);

  const plaintext = concatBytes(encoder.encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));
  const rs = new Uint8Array([0, 0, 16, 0]);
  const keyLength = new Uint8Array([senderPublic.length]);
  return concatBytes(salt, rs, keyLength, senderPublic, ciphertext);
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function sha256Base64url(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64url(new Uint8Array(digest));
}

function base64urlJson(value) {
  return base64url(encoder.encode(JSON.stringify(value)));
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlToBytes(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
