import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { addDays, todayIso } from "./lib/dates";
import type { Category, Condition } from "./lib/validators";

// Demo data for local review: `npx convex run seed:demo`.
// `npx convex run seed:overdue` adds one overdue loan for the reminder workflow's E2E.
// Internal, so they can't be called from the browser. Safe to run repeatedly.
// Demo users have a fake token identifier, so nobody can sign in as them.

const NEIGHBORS = [
  {
    key: "maria",
    name: "Maria (demo)",
    tools: [
      { name: "Cordless drill", category: "power_tools", condition: "good", description: "18V with two batteries and a bit set." },
      { name: "Pressure washer", category: "cleaning", condition: "fair", description: "Great for decks. Bring your own hose." },
    ],
  },
  {
    key: "joao",
    name: "João (demo)",
    tools: [
      { name: "Lawn mower", category: "garden", condition: "good", description: "Electric, cordless. Charger included." },
      { name: "4-person tent", category: "camping", condition: "new", description: "Used once. Stakes and rain fly included." },
    ],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  name: string;
  tools: ReadonlyArray<{ name: string; category: Category; condition: Condition; description: string }>;
}>;

type NeighborKey = (typeof NEIGHBORS)[number]["key"];

// Finds or creates each demo neighbor; a new neighbor also gets their tools.
async function ensureNeighbors(ctx: MutationCtx) {
  const ids = {} as Record<NeighborKey, Id<"users">>;

  for (const neighbor of NEIGHBORS) {
    const tokenIdentifier = `demo|${neighbor.key}`;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .unique();
    if (existing) {
      ids[neighbor.key] = existing._id;
      continue;
    }
    const userId = await ctx.db.insert("users", {
      tokenIdentifier,
      email: `${neighbor.key}@example.com`,
      name: neighbor.name,
      role: "user",
      trustedLender: false,
    });
    ids[neighbor.key] = userId;
    for (const tool of neighbor.tools) {
      await ctx.db.insert("tools", { ownerId: userId, ...tool });
    }
  }
  return ids;
}

export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ids = await ensureNeighbors(ctx);

    // Give every real user something to review in "Incoming requests".
    const demoIds = new Set(Object.values(ids));
    const today = todayIso();
    let requests = 0;
    for (const tool of await ctx.db.query("tools").collect()) {
      if (tool.removedAt || demoIds.has(tool.ownerId)) continue;
      const already = await ctx.db
        .query("loans")
        .withIndex("by_borrower", (q) => q.eq("borrowerId", ids.maria))
        .filter((q) => q.eq(q.field("toolId"), tool._id))
        .first();
      if (already) continue;
      await ctx.db.insert("loans", {
        toolId: tool._id,
        borrowerId: ids.maria,
        lenderId: tool.ownerId,
        startDate: addDays(today, 2),
        endDate: addDays(today, 4),
        status: "pending",
      });
      requests++;
    }

    return { neighbors: Object.keys(ids).length, requestsCreated: requests };
  },
});

// Approved loan that ended 3 days ago, inserted directly so no notification is
// scheduled. Always a new loan: one already reminded today is skipped by /overdue-loans.
export const overdue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ids = await ensureNeighbors(ctx);
    const tool = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", ids.maria))
      .filter((q) => q.eq(q.field("removedAt"), undefined))
      .first();
    if (!tool) throw new Error("Maria (demo) has no tools left");
    const today = todayIso();
    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      borrowerId: ids.joao,
      lenderId: ids.maria,
      startDate: addDays(today, -7),
      endDate: addDays(today, -3),
      status: "approved",
    });
    const borrower = await ctx.db.get(ids.joao);
    return { loanId, borrowerEmail: borrower!.email };
  },
});
