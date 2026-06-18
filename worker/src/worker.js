const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env, request) });
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
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true }, env);
      }
      return json({ ok: false, error: "Not found" }, env, 404, request);
    } catch (error) {
      return json({ ok: false, error: error.message || String(error) }, env, 500, request);
    }
  },
};

function allowedCorsOrigin(env, request) {
  const origin = request?.headers?.get("Origin") || "";
  const allowedOrigins = new Set([
    env.ALLOWED_ORIGIN,
    "https://taiwanrnno1.github.io",
    "http://127.0.0.1:8787",
    "http://127.0.0.1:8788",
    "http://localhost:8787",
    "http://localhost:8788",
    "null",
  ].filter(Boolean));

  if (allowedOrigins.has(origin)) return origin;
  if (!origin) return env.ALLOWED_ORIGIN || "*";
  return env.ALLOWED_ORIGIN || "https://taiwanrnno1.github.io";
}

function corsHeaders(env, request) {
  return {
    "Access-Control-Allow-Origin": allowedCorsOrigin(env, request),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(payload, env, status = 200, request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(env, request),
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
