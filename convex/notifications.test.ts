import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifyRequest } from "./lib/hmac";
import { ADMIN_EMAIL, createTool, requestLoan, setup, signIn } from "./test.setup";

const WEBHOOK = "http://n8n.test/webhook/loan-notification";
const SECRET = "test-secret";

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
  vi.stubEnv("N8N_WEBHOOK_URL", WEBHOOK);
  vi.stubEnv("N8N_HMAC_SECRET", SECRET);
  fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function world() {
  const t = setup();
  const alice = await signIn(t, "alice"); // lender
  const bob = await signIn(t, "bob"); // borrower
  const toolId = await createTool(alice);
  return { t, alice, bob, toolId };
}

type T = Awaited<ReturnType<typeof world>>["t"];

async function flush(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

// The requests n8n actually received, parsed, with their signature checked like n8n would.
async function sentToN8n() {
  return await Promise.all(
    fetchMock.mock.calls.map(async ([input, init]) => {
      const url = String(input);
      const body = init?.body as string;
      const signed = await verifyRequest(SECRET, new Request(url, { method: "POST", headers: init?.headers }), body);
      return { url, signed, body: JSON.parse(body) };
    }),
  );
}

async function events(t: T, loanId: Id<"loans">) {
  return await t.run((ctx) =>
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect(),
  );
}

describe("request notification", () => {
  test("a new request sends the lender a signed, minimal payload", async () => {
    const { t, toolId, bob } = await world();
    const loanId = await requestLoan(bob, toolId, 1, 3);
    await flush(t);

    const [call, ...rest] = await sentToN8n();
    expect(rest).toHaveLength(0);
    expect(call.url).toBe(WEBHOOK);
    expect(call.signed).toBe(true);
    expect(call.body).toEqual({
      event: "loan.requested",
      loanId,
      status: "pending",
      recipient: { email: "alice@example.com", name: "alice" },
      tool: { name: "Cordless drill" },
      startDate: expect.any(String),
      endDate: expect.any(String),
    });
    expect(JSON.stringify(call.body)).not.toContain("bob@example.com");
    expect(await events(t, loanId)).toMatchObject([
      { type: "request_notification", status: "sent", idempotencyKey: `notify:${loanId}:pending` },
    ]);
  });

  test("records a failure without breaking the request", async () => {
    const { t, toolId, bob } = await world();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const loanId = await requestLoan(bob, toolId, 1, 3);
    await flush(t);

    expect(await events(t, loanId)).toMatchObject([{ status: "failed", detail: "n8n responded 500" }]);
  });

  test("records network errors and missing configuration as failures", async () => {
    const { t, toolId, bob } = await world();
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const first = await requestLoan(bob, toolId, 1, 3);
    await flush(t);
    expect(await events(t, first)).toMatchObject([{ status: "failed", detail: "connect ECONNREFUSED" }]);

    vi.stubEnv("N8N_WEBHOOK_URL", "");
    const second = await requestLoan(bob, toolId, 5, 6);
    await flush(t);
    expect(await events(t, second)).toMatchObject([{ status: "failed", detail: "N8N_WEBHOOK_URL not set" }]);

    vi.stubEnv("N8N_WEBHOOK_URL", WEBHOOK);
    vi.stubEnv("N8N_HMAC_SECRET", "");
    const third = await requestLoan(bob, toolId, 8, 9);
    await flush(t);
    expect(await events(t, third)).toMatchObject([{ status: "failed", detail: "N8N_HMAC_SECRET not set" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("sending the same notification twice posts once", async () => {
    const { t, toolId, bob } = await world();
    const loanId = await requestLoan(bob, toolId, 1, 3);
    await flush(t);
    await t.action(internal.notifications.send, { loanId, status: "pending" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await events(t, loanId)).toHaveLength(1);
  });

  test("approve, decline and return notify the borrower with the new status", async () => {
    const { t, alice, bob, toolId } = await world();
    const approved = await requestLoan(bob, toolId, 1, 2);
    const declined = await requestLoan(bob, toolId, 5, 6);
    await alice.as.mutation(api.loans.approve, { loanId: approved });
    await alice.as.mutation(api.loans.decline, { loanId: declined });
    await alice.as.mutation(api.loans.markReturned, { loanId: approved });
    await flush(t);

    const toBob = (await sentToN8n()).filter((c) => c.body.recipient.email === "bob@example.com");
    expect(toBob.map((c) => [c.body.loanId, c.body.status, c.body.event])).toEqual(
      expect.arrayContaining([
        [approved, "approved", "loan.status_changed"],
        [declined, "declined", "loan.status_changed"],
        [approved, "returned", "loan.status_changed"],
      ]),
    );
    expect(toBob).toHaveLength(3);
    expect(toBob.every((c) => c.signed)).toBe(true);
  });

  test("auto-declined overlapping requests notify their borrowers", async () => {
    const { t, alice, bob, toolId } = await world();
    const carol = await signIn(t, "carol");
    const winner = await requestLoan(bob, toolId, 1, 3);
    const loser = await requestLoan(carol, toolId, 2, 4);
    await alice.as.mutation(api.loans.approve, { loanId: winner });
    await flush(t);

    const toCarol = (await sentToN8n()).filter((c) => c.body.recipient.email === "carol@example.com");
    expect(toCarol.map((c) => [c.body.loanId, c.body.status])).toEqual([[loser, "declined"]]);
  });

  test("removing a tool notifies the borrowers whose loans were cancelled", async () => {
    const { t, alice, bob, toolId } = await world();
    const loanId = await requestLoan(bob, toolId, 1, 3);
    await alice.as.mutation(api.tools.remove, { toolId });
    await flush(t);

    const toBob = (await sentToN8n()).filter((c) => c.body.recipient.email === "bob@example.com");
    expect(toBob.map((c) => [c.body.loanId, c.body.status])).toEqual([[loanId, "cancelled"]]);
  });

  test("a retry after a failure upgrades the event to sent", async () => {
    const { t, toolId, bob } = await world();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const loanId = await requestLoan(bob, toolId, 1, 3);
    await flush(t);
    await t.action(internal.notifications.send, { loanId, status: "pending" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await events(t, loanId)).toMatchObject([{ status: "sent" }]);
  });
});
