import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { availabilityOf, getApprovedLoans } from "./lib/availability";
import { todayIso } from "./lib/dates";
import { appError } from "./lib/errors";
import { LIMITS, vCategory, vCondition } from "./lib/validators";

// ── Queries ─────────────────────────────────────────────────────────

// Public landing page. Deliberately returns only name + category: no owner,
// description or condition is exposed to anonymous visitors.
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const today = todayIso();
    const tools = await ctx.db.query("tools").order("desc").collect();
    const result = [];
    for (const tool of tools) {
      if (tool.removedAt) continue;
      if (availabilityOf(await getApprovedLoans(ctx, tool._id), today) !== "available") continue;
      result.push({ _id: tool._id, name: tool.name, category: tool.category });
    }
    return result;
  },
});

// Signed-in catalog with availability, optionally filtered by category.
export const list = query({
  args: { category: v.optional(vCategory) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const today = todayIso();

    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .order("desc")
          .collect()
      : await ctx.db.query("tools").order("desc").collect();

    const result = [];
    for (const tool of tools) {
      if (tool.removedAt) continue;
      const approved = await getApprovedLoans(ctx, tool._id);
      const owner = await ctx.db.get(tool.ownerId);
      result.push({
        ...publicFields(tool),
        // Only what a borrower needs to decide; no owner email.
        owner: { name: owner?.name ?? "Unknown", trustedLender: owner?.trustedLender ?? false },
        isMine: tool.ownerId === me._id,
        availability: availabilityOf(approved, today),
        // Upcoming/current approved ranges so the UI can avoid conflicts.
        bookedRanges: approved
          .filter((loan) => loan.endDate >= today)
          .map((loan) => ({ startDate: loan.startDate, endDate: loan.endDate })),
      });
    }
    return result;
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const today = todayIso();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();

    const result = [];
    for (const tool of tools) {
      if (tool.removedAt) continue;
      result.push({
        ...publicFields(tool),
        availability: availabilityOf(await getApprovedLoans(ctx, tool._id), today),
      });
    }
    return result;
  },
});

// ── Mutations ───────────────────────────────────────────────────────

const toolInput = {
  name: v.string(),
  category: vCategory,
  condition: vCondition,
  description: v.string(),
};

export const create = mutation({
  args: toolInput,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return await ctx.db.insert("tools", { ownerId: me._id, ...cleanToolInput(args) });
  },
});

// Owners only. Admins moderate by removing, not by editing someone's listing.
export const update = mutation({
  args: { toolId: v.id("tools"), ...toolInput },
  handler: async (ctx, { toolId, ...args }) => {
    const me = await requireUser(ctx);
    const tool = await getActiveTool(ctx, toolId);
    if (tool.ownerId !== me._id) {
      throw appError("FORBIDDEN", "You can only edit your own listings.");
    }
    await ctx.db.patch(toolId, cleanToolInput(args));
  },
});

// Owner or admin. Pending requests on the tool are declined. An owner cannot
// remove a tool that is currently lent out; an admin can (moderation), and the
// approved loans are kept as-is so they can still be tracked and returned.
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await getActiveTool(ctx, toolId);
    const isOwner = tool.ownerId === me._id;
    const isAdmin = me.role === "admin";
    if (!isOwner && !isAdmin) {
      throw appError("FORBIDDEN", "You can only remove your own listings.");
    }

    if (!isAdmin && availabilityOf(await getApprovedLoans(ctx, toolId)) === "on_loan") {
      throw appError("CONFLICT", "This tool is lent out. Mark it returned before removing it.");
    }

    const now = Date.now();
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    for (const loan of pending) {
      await ctx.db.patch(loan._id, { status: "declined", decidedAt: now });
    }

    await ctx.db.patch(toolId, { removedAt: now, removedBy: me._id });
  },
});

// ── Helpers ─────────────────────────────────────────────────────────

function publicFields(tool: Doc<"tools">) {
  return {
    _id: tool._id,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    description: tool.description,
  };
}

async function getActiveTool(ctx: MutationCtx, toolId: Doc<"tools">["_id"]) {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.removedAt) throw appError("NOT_FOUND", "Tool not found.");
  return tool;
}

function cleanToolInput<T extends { name: string; description: string }>(args: T): T {
  const name = args.name.trim();
  const description = args.description.trim();
  if (!name) throw appError("INVALID_INPUT", "Name is required.");
  if (name.length > LIMITS.toolName) {
    throw appError("INVALID_INPUT", `Name must be at most ${LIMITS.toolName} characters.`);
  }
  if (description.length > LIMITS.toolDescription) {
    throw appError(
      "INVALID_INPUT",
      `Description must be at most ${LIMITS.toolDescription} characters.`,
    );
  }
  return { ...args, name, description };
}
