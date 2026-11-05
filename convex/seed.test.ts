import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { todayIso } from "./lib/dates";
import { createTool, setup, signIn } from "./test.setup";

describe("seed:overdue", () => {
  test("creates a new 3-day overdue loan each call, without scheduling a notification", async () => {
    const t = setup();
    const first = await t.mutation(internal.seed.overdue, {});
    expect(first.borrowerEmail).toBe("joao@example.com");

    const { loans } = await t.query(internal.automation.overdue, { today: todayIso() });
    expect(loans).toEqual([
      expect.objectContaining({
        loanId: first.loanId,
        daysOverdue: 3,
        borrower: expect.objectContaining({ email: "joao@example.com" }),
      }),
    ]);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toEqual([]);

    const second = await t.mutation(internal.seed.overdue, {});
    expect(second.loanId).not.toBe(first.loanId);
    const after = await t.query(internal.automation.overdue, { today: todayIso() });
    expect(after.loans.map((l) => l.loanId).sort()).toEqual([first.loanId, second.loanId].sort());
  });
});

describe("seed:demo", () => {
  test("creates the two neighbors and one request per real user's tool, only once", async () => {
    const t = setup();
    await createTool(await signIn(t, "alice"));
    expect(await t.mutation(internal.seed.demo, {})).toEqual({ neighbors: 2, requestsCreated: 1 });
    expect(await t.mutation(internal.seed.demo, {})).toEqual({ neighbors: 2, requestsCreated: 0 });
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(3);
  });
});
