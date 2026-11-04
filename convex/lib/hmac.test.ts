import { describe, expect, test } from "vitest";
import { MAX_SKEW_SECONDS, SIGNATURE_HEADER, signedHeaders, TIMESTAMP_HEADER, verifyRequest } from "./hmac";

const SECRET = "test-secret";
const URL_ = "https://convex.test/reminder-status";
const BODY = '{"loanId":"abc"}';

async function signed(overrides: { method?: string; path?: string; body?: string; now?: number } = {}) {
  return await signedHeaders(
    SECRET,
    overrides.method ?? "POST",
    overrides.path ?? "/reminder-status",
    overrides.body ?? BODY,
    overrides.now,
  );
}

function req(headers: Record<string, string>, { method = "POST", url = URL_ } = {}) {
  return new Request(url, { method, headers, body: method === "GET" ? undefined : BODY });
}

describe("hmac", () => {
  test("accepts a correctly signed request", async () => {
    expect(await verifyRequest(SECRET, req(await signed()), BODY)).toBe(true);
  });

  test("signs GET requests with an empty body", async () => {
    const headers = await signed({ method: "GET", path: "/overdue-loans", body: "" });
    expect(await verifyRequest(SECRET, req(headers, { method: "GET", url: "https://convex.test/overdue-loans" }), "")).toBe(true);
  });

  test("rejects a tampered body, path, method or secret", async () => {
    const headers = await signed();
    expect(await verifyRequest(SECRET, req(headers), BODY + " ")).toBe(false);
    expect(await verifyRequest(SECRET, req(headers, { url: "https://convex.test/overdue-loans" }), BODY)).toBe(false);
    expect(await verifyRequest(SECRET, req(headers, { method: "PUT" }), BODY)).toBe(false);
    expect(await verifyRequest("other-secret", req(headers), BODY)).toBe(false);
  });

  test("rejects timestamps outside the window, in both directions", async () => {
    const skew = (MAX_SKEW_SECONDS + 5) * 1000;
    expect(await verifyRequest(SECRET, req(await signed({ now: Date.now() - skew })), BODY)).toBe(false);
    expect(await verifyRequest(SECRET, req(await signed({ now: Date.now() + skew })), BODY)).toBe(false);
    expect(await verifyRequest(SECRET, req(await signed({ now: Date.now() - 60_000 })), BODY)).toBe(true);
  });

  test("rejects missing or malformed headers without throwing", async () => {
    const good = await signed();
    expect(await verifyRequest(SECRET, req({}), BODY)).toBe(false);
    expect(await verifyRequest(SECRET, req({ [TIMESTAMP_HEADER]: good[TIMESTAMP_HEADER] }), BODY)).toBe(false);
    expect(await verifyRequest(SECRET, req({ ...good, [SIGNATURE_HEADER]: "sha256=zz" }), BODY)).toBe(false);
    expect(await verifyRequest(SECRET, req({ ...good, [TIMESTAMP_HEADER]: "soon" }), BODY)).toBe(false);
  });
});
