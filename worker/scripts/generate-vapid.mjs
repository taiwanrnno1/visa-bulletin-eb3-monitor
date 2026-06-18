const subtle = globalThis.crypto.subtle;
const keyPair = await subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const publicRaw = new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey));
const privateJwk = await subtle.exportKey("jwk", keyPair.privateKey);

function base64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

console.log("VAPID_PUBLIC_KEY=" + base64url(publicRaw));
console.log("VAPID_PRIVATE_JWK=" + JSON.stringify(privateJwk));
