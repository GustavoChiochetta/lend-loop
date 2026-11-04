import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import {
  ADMIN_EMAIL,
  createTool,
  requestLoan,
  setup,
  signIn,
  withCode,
} from "./test.setup";

beforeEach(() => vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL));
afterEach(() => vi.unstubAllEnvs());

describe("tools.listPublic", () => {
  test("is anonymous and exposes only name and category", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    await createTool(alice);

    const tools = await t.query(api.tools.listPublic, {});
    expect(tools).toHaveLength(1);
    expect(Object.keys(tools[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  test("hides tools that are lent out or removed", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const bob = await signIn(t, "bob");
    const lent = await createTool(alice, { name: "Lent drill" });
    const removed = await createTool(alice, { name: "Removed saw" });
    await createTool(alice, { name: "Free ladder" });

    const loanId = await requestLoan(bob, lent, 0, 2);
    await alice.as.mutation(api.loans.approve, { loanId });
    await alice.as.mutation(api.tools.remove, { toolId: removed });

    const names = (await t.query(api.tools.listPublic, {})).map((tool) => tool.name);
    expect(names).toEqual(["Free ladder"]);
  });
});

describe("tools.list", () => {
  test("requires sign-in", async () => {
    const t = setup();
    await expect(t.query(api.tools.list, {})).rejects.toMatchObject(withCode("UNAUTHENTICATED"));
  });

  test("filters by category and reports availability without owner email", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const bob = await signIn(t, "bob");
    const drill = await createTool(alice, { name: "Drill", category: "power_tools" });
    await createTool(alice, { name: "Rake", category: "garden" });
    const loanId = await requestLoan(bob, drill, 0, 1);
    await alice.as.mutation(api.loans.approve, { loanId });

    const garden = await bob.as.query(api.tools.list, { category: "garden" });
    expect(garden.map((tool) => tool.name)).toEqual(["Rake"]);

    const all = await bob.as.query(api.tools.list, {});
    const drillView = all.find((tool) => tool.name === "Drill")!;
    expect(drillView.availability).toBe("on_loan");
    expect(drillView.isMine).toBe(false);
    expect(drillView.owner).toEqual({ name: "alice", trustedLender: false });
    expect(JSON.stringify(all)).not.toContain("@example.com");
  });
});

describe("tools.create / update", () => {
  test("validates input on the server", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const base = { category: "garden" as const, condition: "good" as const, description: "" };

    await expect(
      alice.as.mutation(api.tools.create, { ...base, name: "   " }),
    ).rejects.toMatchObject(withCode("INVALID_INPUT"));
    await expect(
      alice.as.mutation(api.tools.create, { ...base, name: "x".repeat(81) }),
    ).rejects.toMatchObject(withCode("INVALID_INPUT"));
    // Enum values are enforced by Convex validators, not just TypeScript.
    await expect(
      alice.as.mutation(api.tools.create, { ...base, name: "Rake", category: "weapons" as never }),
    ).rejects.toThrow();
  });

  test("only the owner can edit, admins included", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const bob = await signIn(t, "bob");
    const admin = await signIn(t, "admin", { email: ADMIN_EMAIL });
    const toolId = await createTool(alice);
    const edit = {
      toolId,
      name: "Hacked",
      category: "garden" as const,
      condition: "worn" as const,
      description: "",
    };

    await expect(bob.as.mutation(api.tools.update, edit)).rejects.toMatchObject(withCode("FORBIDDEN"));
    await expect(admin.as.mutation(api.tools.update, edit)).rejects.toMatchObject(withCode("FORBIDDEN"));

    await alice.as.mutation(api.tools.update, { ...edit, name: "Drill v2" });
    const [mine] = await alice.as.query(api.tools.myListings, {});
    expect(mine.name).toBe("Drill v2");
  });
});

describe("tools.remove", () => {
  test("other users cannot remove; admins can remove any listing", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const bob = await signIn(t, "bob");
    const admin = await signIn(t, "admin", { email: ADMIN_EMAIL });
    const toolId = await createTool(alice);

    await expect(bob.as.mutation(api.tools.remove, { toolId })).rejects.toMatchObject(
      withCode("FORBIDDEN"),
    );
    await admin.as.mutation(api.tools.remove, { toolId });
    expect(await alice.as.query(api.tools.myListings, {})).toHaveLength(0);
  });

  test("owner cannot remove a lent-out tool, and removal cancels pending requests", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const bob = await signIn(t, "bob");
    const carol = await signIn(t, "carol");
    const toolId = await createTool(alice);

    const bobLoan = await requestLoan(bob, toolId, 0, 1);
    await alice.as.mutation(api.loans.approve, { loanId: bobLoan });
    await expect(alice.as.mutation(api.tools.remove, { toolId })).rejects.toMatchObject(
      withCode("CONFLICT"),
    );

    await alice.as.mutation(api.loans.markReturned, { loanId: bobLoan });
    await requestLoan(carol, toolId, 5, 6);
    await alice.as.mutation(api.tools.remove, { toolId });

    const [carolRequest] = await carol.as.query(api.loans.myRequests, {});
    expect(carolRequest.status).toBe("cancelled");
    expect(carolRequest.tool.removed).toBe(true);
  });

  test("removal cancels approved loans that haven't started", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const bob = await signIn(t, "bob");
    const toolId = await createTool(alice);
    const loanId = await requestLoan(bob, toolId, 5, 6);
    await alice.as.mutation(api.loans.approve, { loanId });

    await alice.as.mutation(api.tools.remove, { toolId });

    const [loan] = await bob.as.query(api.loans.myRequests, {});
    expect(loan.status).toBe("cancelled");
  });

  test("admin removal keeps a loan under way so it can be returned", async () => {
    const t = setup();
    const alice = await signIn(t, "alice");
    const bob = await signIn(t, "bob");
    const admin = await signIn(t, "admin", { email: ADMIN_EMAIL });
    const toolId = await createTool(alice);
    const loanId = await requestLoan(bob, toolId, 0, 1);
    await alice.as.mutation(api.loans.approve, { loanId });

    await admin.as.mutation(api.tools.remove, { toolId });
    await alice.as.mutation(api.loans.markReturned, { loanId });

    const [loan] = await bob.as.query(api.loans.myRequests, {});
    expect(loan.status).toBe("returned");
  });
});
