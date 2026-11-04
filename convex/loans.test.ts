import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import {
  ADMIN_EMAIL,
  createTool,
  day,
  requestLoan,
  setup,
  signIn,
  withCode,
} from "./test.setup";

beforeEach(() => vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL));
afterEach(() => vi.unstubAllEnvs());

async function world() {
  const t = setup();
  const alice = await signIn(t, "alice"); // lender
  const bob = await signIn(t, "bob"); // borrower
  const carol = await signIn(t, "carol"); // unrelated user
  const admin = await signIn(t, "admin", { email: ADMIN_EMAIL });
  const toolId = await createTool(alice);
  return { t, alice, bob, carol, admin, toolId };
}

describe("loans.request", () => {
  test("validates ownership and dates", async () => {
    const { alice, bob, toolId } = await world();

    await expect(requestLoan(alice, toolId, 1, 2)).rejects.toMatchObject(withCode("INVALID_INPUT"));
    await expect(requestLoan(bob, toolId, -1, 2)).rejects.toMatchObject(withCode("INVALID_INPUT"));
    await expect(requestLoan(bob, toolId, 3, 2)).rejects.toMatchObject(withCode("INVALID_INPUT"));
    await expect(requestLoan(bob, toolId, 0, 30)).rejects.toMatchObject(withCode("INVALID_INPUT"));
    await expect(
      bob.as.mutation(api.loans.request, { toolId, startDate: "2030-02-31", endDate: "2030-03-01" }),
    ).rejects.toMatchObject(withCode("INVALID_INPUT"));

    await expect(requestLoan(bob, toolId, 0, 29)).resolves.toBeDefined();
  });

  test("rejects dates that overlap an approved loan or my own pending request", async () => {
    const { alice, bob, carol, toolId } = await world();
    const loanId = await requestLoan(bob, toolId, 1, 3);

    await expect(requestLoan(bob, toolId, 3, 4)).rejects.toMatchObject(withCode("CONFLICT"));
    // Someone else may still ask for overlapping dates while it is only pending.
    await expect(requestLoan(carol, toolId, 2, 2)).resolves.toBeDefined();

    await alice.as.mutation(api.loans.approve, { loanId });
    await expect(requestLoan(carol, toolId, 3, 5)).rejects.toMatchObject(withCode("CONFLICT"));
    await expect(requestLoan(carol, toolId, 4, 5)).resolves.toBeDefined();
  });
});

describe("approve / decline / markReturned", () => {
  test("only the lender can act; borrower, third parties and admins cannot", async () => {
    const { alice, bob, carol, admin, toolId } = await world();
    const loanId = await requestLoan(bob, toolId, 1, 2);

    for (const actor of [bob, carol, admin]) {
      await expect(actor.as.mutation(api.loans.approve, { loanId })).rejects.toMatchObject(
        withCode("FORBIDDEN"),
      );
      await expect(actor.as.mutation(api.loans.decline, { loanId })).rejects.toMatchObject(
        withCode("FORBIDDEN"),
      );
    }

    await alice.as.mutation(api.loans.approve, { loanId });
    await expect(bob.as.mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject(
      withCode("FORBIDDEN"),
    );
    await alice.as.mutation(api.loans.markReturned, { loanId });

    const [view] = await bob.as.query(api.loans.myRequests, {});
    expect(view.status).toBe("returned");
    expect(view.returnedAt).toBeTypeOf("number");
  });

  test("enforces the status lifecycle", async () => {
    const { alice, bob, toolId } = await world();
    const loanId = await requestLoan(bob, toolId, 1, 2);

    await expect(alice.as.mutation(api.loans.markReturned, { loanId })).rejects.toMatchObject(
      withCode("CONFLICT"),
    );
    await alice.as.mutation(api.loans.decline, { loanId });
    await expect(alice.as.mutation(api.loans.approve, { loanId })).rejects.toMatchObject(
      withCode("CONFLICT"),
    );

    const approvedId = await requestLoan(bob, toolId, 1, 2);
    await alice.as.mutation(api.loans.approve, { loanId: approvedId });
    await expect(alice.as.mutation(api.loans.decline, { loanId: approvedId })).rejects.toMatchObject(
      withCode("CONFLICT"),
    );
    await expect(alice.as.mutation(api.loans.approve, { loanId: approvedId })).rejects.toThrow(
      /approved and can't become approved/,
    );
  });

  test("approving declines overlapping pending requests only", async () => {
    const { alice, bob, carol, toolId } = await world();
    const bobLoan = await requestLoan(bob, toolId, 1, 3);
    const carolOverlap = await requestLoan(carol, toolId, 3, 4);
    const carolLater = await requestLoan(carol, toolId, 10, 11);

    await alice.as.mutation(api.loans.approve, { loanId: bobLoan });

    const statuses = Object.fromEntries(
      (await alice.as.query(api.loans.incoming, {})).map((loan) => [loan._id, loan.status]),
    );
    expect(statuses).toEqual({
      [bobLoan]: "approved",
      [carolOverlap]: "declined",
      [carolLater]: "pending",
    });
  });
});

describe("loan views", () => {
  test("each user only sees their own side; listAll is admin-only", async () => {
    const { alice, bob, carol, admin, toolId } = await world();
    await requestLoan(bob, toolId, 1, 2);

    expect(await bob.as.query(api.loans.myRequests, {})).toHaveLength(1);
    expect(await alice.as.query(api.loans.incoming, {})).toHaveLength(1);
    expect(await carol.as.query(api.loans.myRequests, {})).toHaveLength(0);
    expect(await carol.as.query(api.loans.incoming, {})).toHaveLength(0);

    await expect(carol.as.query(api.loans.listAll, {})).rejects.toMatchObject(withCode("FORBIDDEN"));
    const all = await admin.as.query(api.loans.listAll, {});
    expect(all).toHaveLength(1);
    expect(JSON.stringify(all)).not.toContain("@example.com");
  });

  test("flags approved loans past their end date as overdue", async () => {
    const { t, alice, bob, toolId } = await world();
    const loanId = await requestLoan(bob, toolId, 0, 1);
    await alice.as.mutation(api.loans.approve, { loanId });
    // Move the loan into the past directly, as if days had gone by.
    await t.run((ctx) => ctx.db.patch(loanId, { startDate: day(-5), endDate: day(-1) }));

    const [view] = await bob.as.query(api.loans.myRequests, {});
    expect(view.isOverdue).toBe(true);
    const [tool] = await alice.as.query(api.tools.myListings, {});
    expect(tool.availability).toBe("on_loan");
  });
});
