import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { signedHeaders } from "./lib/hmac";
import { ADMIN_EMAIL, createTool, day, setup, signIn } from "./test.setup";

const SECRET = "test-secret";

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
  vi.stubEnv("N8N_HMAC_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

async function world() {
  const t = setup();
  const alice = await signIn(t, "alice");
  const bob = await signIn(t, "bob");
  const toolId = await createTool(alice);
  // Loans are inserted directly: the request mutation refuses past dates.
  const loan = (status: "approved" | "returned" | "pending", startDate: string, endDate: string) =>
    t.run((ctx) =>
      ctx.db.insert("loans", { toolId, borrowerId: bob.id, lenderId: alice.id, startDate, endDate, status }),
    );
  return { t, loan };
}

type T = Awaited<ReturnType<typeof world>>["t"];

async function getOverdue(t: T, headers?: Record<string, string>) {
  return await t.fetch("/overdue-loans", {
    method: "GET",
    headers: headers ?? (await signedHeaders(SECRET, "GET", "/overdue-loans", "")),
  });
}

async function postReminder(t: T, body: unknown) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return await t.fetch("/reminder-status", {
    method: "POST",
    headers: await signedHeaders(SECRET, "POST", "/reminder-status", raw),
    body: raw,
  });
}

async function reminders(t: T, loanId: Id<"loans">) {
  return await t.run((ctx) =>
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect(),
  );
}

describe("every route", () => {
  test("fails closed when the secret isn't configured, even for a correctly signed request", async () => {
    const { t, loan } = await world();
    const loanId = await loan("approved", day(-5), day(-3));
    const overdue = await signedHeaders(SECRET, "GET", "/overdue-loans", "");
    const raw = JSON.stringify({ loanId, date: day(0), status: "sent" });
    const reminder = await signedHeaders(SECRET, "POST", "/reminder-status", raw);
    vi.stubEnv("N8N_HMAC_SECRET", "");

    expect((await getOverdue(t, overdue)).status).toBe(401);
    expect((await t.fetch("/reminder-status", { method: "POST", headers: reminder, body: raw })).status).toBe(401);
    expect(await reminders(t, loanId)).toHaveLength(0);
  });
});

describe("GET /overdue-loans", () => {
  test("rejects missing, forged and stale signatures", async () => {
    const { t } = await world();
    expect((await getOverdue(t, {})).status).toBe(401);
    expect((await getOverdue(t, await signedHeaders("wrong", "GET", "/overdue-loans", ""))).status).toBe(401);
    expect((await getOverdue(t, await signedHeaders(SECRET, "POST", "/overdue-loans", ""))).status).toBe(401);
    const stale = await signedHeaders(SECRET, "GET", "/overdue-loans", "", Date.now() - 10 * 60_000);
    expect((await getOverdue(t, stale)).status).toBe(401);
  });

  test("lists only approved loans past their end date, with minimal fields", async () => {
    const { t, loan } = await world();
    const overdue = await loan("approved", day(-5), day(-3));
    await loan("approved", day(-2), day(0)); // ends today: not overdue yet
    await loan("returned", day(-5), day(-3));
    await loan("pending", day(-5), day(-3));

    const res = await getOverdue(t);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      date: day(0),
      loans: [
        {
          loanId: overdue,
          borrower: { email: "bob@example.com", name: "bob" },
          tool: { name: "Cordless drill" },
          endDate: day(-3),
          daysOverdue: 3,
        },
      ],
    });
  });
});

describe("POST /reminder-status", () => {
  test("rejects an unsigned request", async () => {
    const { t, loan } = await world();
    const loanId = await loan("approved", day(-5), day(-3));
    const res = await t.fetch("/reminder-status", {
      method: "POST",
      body: JSON.stringify({ loanId, date: day(0), status: "sent" }),
    });
    expect(res.status).toBe(401);
    expect(await reminders(t, loanId)).toHaveLength(0);
  });

  test("rejects malformed bodies", async () => {
    const { t, loan } = await world();
    const loanId = await loan("approved", day(-5), day(-3));
    const valid = { loanId, date: day(0), status: "sent" };
    const deletedLoan = await loan("approved", day(-5), day(-3));
    await t.run((ctx) => ctx.db.delete(deletedLoan));

    for (const body of [
      "not json",
      "null",
      { ...valid, loanId: "nope" },
      { ...valid, loanId: deletedLoan },
      { ...valid, date: "2026-02-31" },
      { ...valid, status: "delivered" },
      { ...valid, detail: "x".repeat(501) },
      { ...valid, detail: 42 },
      "[]",
    ]) {
      expect((await postReminder(t, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await reminders(t, loanId)).toHaveLength(0);

    expect((await postReminder(t, { ...valid, detail: "x".repeat(500) })).status).toBe(200);
    expect(await reminders(t, loanId)).toMatchObject([{ detail: "x".repeat(500) }]);
  });

  test("is idempotent, upgrades failed to sent, and hides the loan from today's overdue list", async () => {
    const { t, loan } = await world();
    const loanId = await loan("approved", day(-5), day(-3));

    expect((await postReminder(t, { loanId, date: day(0), status: "failed", detail: "SMTP down" })).status).toBe(200);
    expect((await (await getOverdue(t)).json()).loans).toHaveLength(1);

    expect((await postReminder(t, { loanId, date: day(0), status: "sent" })).status).toBe(200);
    expect((await postReminder(t, { loanId, date: day(0), status: "sent" })).status).toBe(200);
    expect((await postReminder(t, { loanId, date: day(0), status: "failed" })).status).toBe(200);

    expect(await reminders(t, loanId)).toMatchObject([
      { type: "overdue_reminder", status: "sent", idempotencyKey: `reminder:${loanId}:${day(0)}` },
    ]);
    expect((await (await getOverdue(t)).json()).loans).toHaveLength(0);
  });
});

describe("POST /workflow-error", () => {
  async function postError(t: T, body: unknown) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return await t.fetch("/workflow-error", {
      method: "POST",
      headers: await signedHeaders(SECRET, "POST", "/workflow-error", raw),
      body: raw,
    });
  }

  async function errors(t: T) {
    return await t.run((ctx) =>
      ctx.db
        .query("automationEvents")
        .filter((q) => q.eq(q.field("type"), "workflow_error"))
        .collect(),
    );
  }

  const valid = { executionId: "exec-1", workflow: "Overdue reminders", node: "Send email", message: "SMTP down" };

  test("rejects unsigned and forged requests", async () => {
    const { t } = await world();
    const raw = JSON.stringify(valid);
    expect((await t.fetch("/workflow-error", { method: "POST", body: raw })).status).toBe(401);
    const forged = await signedHeaders(SECRET, "POST", "/workflow-error", raw);
    const tampered = JSON.stringify({ ...valid, message: "other" });
    expect((await t.fetch("/workflow-error", { method: "POST", headers: forged, body: tampered })).status).toBe(401);
    expect(await errors(t)).toHaveLength(0);
  });

  test("rejects malformed bodies", async () => {
    const { t } = await world();
    for (const body of [
      "not json",
      "null",
      "42",
      { ...valid, executionId: undefined },
      { ...valid, workflow: undefined },
      { ...valid, message: undefined },
      { ...valid, executionId: "" },
      { ...valid, executionId: 1 },
      { ...valid, executionId: "x".repeat(101) },
      { ...valid, workflow: "" },
      { ...valid, workflow: 1 },
      { ...valid, message: 1 },
      { ...valid, message: "x".repeat(501) },
      { ...valid, node: 1 },
      { ...valid, loanId: 1 },
    ]) {
      expect((await postError(t, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await errors(t)).toHaveLength(0);

    expect((await postError(t, { ...valid, message: "x".repeat(500) })).status).toBe(200);
    expect(await errors(t)).toHaveLength(1);
  });

  test("stores one failed row per execution, and a repeat keeps it", async () => {
    const { t } = await world();
    for (let i = 0; i < 2; i++) {
      const res = await postError(t, valid);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(await errors(t)).toMatchObject([
      {
        status: "failed",
        idempotencyKey: "error:exec-1",
        detail: "Overdue reminders / Send email: SMTP down",
      },
    ]);
  });

  test("leaves the node out of the detail when it isn't given", async () => {
    const { t } = await world();
    expect((await postError(t, { ...valid, node: undefined })).status).toBe(200);
    expect(await errors(t)).toMatchObject([{ detail: "Overdue reminders: SMTP down" }]);
  });

  test("links an existing loan and drops a loanId that doesn't resolve", async () => {
    const { t, loan } = await world();
    const loanId = await loan("approved", day(-5), day(-3));
    const deletedLoan = await loan("approved", day(-5), day(-3));
    await t.run((ctx) => ctx.db.delete(deletedLoan));

    expect((await postError(t, { ...valid, executionId: "linked", loanId })).status).toBe(200);
    expect((await postError(t, { ...valid, executionId: "malformed", loanId: "nope" })).status).toBe(200);
    expect((await postError(t, { ...valid, executionId: "deleted", loanId: deletedLoan })).status).toBe(200);

    const byKey = Object.fromEntries((await errors(t)).map((e) => [e.idempotencyKey, e.loanId]));
    expect(byKey).toEqual({ "error:linked": loanId, "error:malformed": undefined, "error:deleted": undefined });
  });

  test("cuts a detail longer than the limit", async () => {
    const { t } = await world();
    expect((await postError(t, { ...valid, workflow: "w".repeat(600) })).status).toBe(200);
    const [row] = await errors(t);
    expect(row.detail).toHaveLength(500);
    expect(row.detail).toBe("w".repeat(500));
  });
});
