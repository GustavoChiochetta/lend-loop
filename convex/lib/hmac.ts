// HMAC-SHA256 over `${timestamp}\n${METHOD}\n${path}\n${body}`, shared by both
// directions (Convex -> n8n and n8n -> Convex). Method and path are signed so a
// valid signature for one endpoint can't be replayed against another.

export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

function importKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

function message(timestamp: string, method: string, path: string, body: string) {
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${body}`;
}

function toHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
}

export async function signedHeaders(
  secret: string,
  method: string,
  path: string,
  body: string,
  now: number = Date.now(),
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(now / 1000));
  const key = await importKey(secret, "sign");
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message(timestamp, method, path, body)));
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: `sha256=${toHex(mac)}` };
}

// Never throws on malformed headers: they are simply "not authentic".
export async function verifyRequest(
  secret: string,
  req: Request,
  body: string,
  now: number = Date.now(),
): Promise<boolean> {
  const timestamp = req.headers.get(TIMESTAMP_HEADER);
  const signature = req.headers.get(SIGNATURE_HEADER);
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;

  const mac = fromHex(signature.replace(/^sha256=/, ""));
  if (!mac) return false;

  const key = await importKey(secret, "verify");
  // subtle.verify compares in constant time.
  return await crypto.subtle.verify(
    "HMAC",
    key,
    mac,
    encoder.encode(message(timestamp, req.method, new URL(req.url).pathname, body)),
  );
}
