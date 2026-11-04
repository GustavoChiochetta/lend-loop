import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";
import { getLoans } from "./lib/availability";
import { addDays, assertIsoDate, MAX_LOAN_DAYS, rangesOverlap, todayIso } from "./lib/dates";
import { appError } from "./lib/errors";
import { openLoan, transition } from "./lib/lifecycle";

// ── Mutations ───────────────────────────────────────────────────────

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt) throw appError("NOT_FOUND", "Tool not found.");
    if (tool.ownerId === me._id) {
      throw appError("INVALID_INPUT", "You can't borrow your own tool.");
    }

    assertIsoDate(startDate, "Start date");
    assertIsoDate(endDate, "End date");
    if (startDate < todayIso()) throw appError("INVALID_INPUT", "Start date can't be in the past.");
    if (endDate < startDate) throw appError("INVALID_INPUT", "End date must be on or after start date.");
    if (endDate > addDays(startDate, MAX_LOAN_DAYS - 1)) {
      throw appError("INVALID_INPUT", `Loans can last at most ${MAX_LOAN_DAYS} days.`);
    }

    const range = { startDate, endDate };
    const approved = await getLoans(ctx, toolId, "approved");
    if (approved.some((loan) => rangesOverlap(loan, range))) {
      throw appError("CONFLICT", "The tool is already booked for those dates.");
    }

    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .filter((q) => q.and(q.eq(q.field("toolId"), toolId), q.eq(q.field("status"), "pending")))
      .collect();
    if (myPending.some((loan) => rangesOverlap(loan, range))) {
      throw appError("CONFLICT", "You already have a pending request for those dates.");
    }

    return await openLoan(ctx, { toolId, borrowerId: me._id, lenderId: tool.ownerId, startDate, endDate });
  },
});

// Approving also declines the other pending requests that overlap it,
// so the lender never ends up with two approved loans for the same days.
export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoanAsLender(ctx, loanId);
    const tool = await ctx.db.get(loan.toolId);
    if (!tool || tool.removedAt) throw appError("CONFLICT", "This tool is no longer listed.");
    if (loan.endDate < todayIso()) {
      throw appError("CONFLICT", "The requested dates have already passed. Decline it instead.");
    }

    const approved = await getLoans(ctx, loan.toolId, "approved");
    if (approved.some((other) => other._id !== loan._id && rangesOverlap(other, loan))) {
      throw appError("CONFLICT", "Another approved loan overlaps these dates.");
    }

    await transition(ctx, loan, "approved");

    for (const other of await getLoans(ctx, loan.toolId, "pending")) {
      if (rangesOverlap(other, loan)) await transition(ctx, other, "declined");
    }
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoanAsLender(ctx, loanId);
    await transition(ctx, loan, "declined");
  },
});

// The lender confirms the tool is back: they are the one who knows.
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoanAsLender(ctx, loanId);
    await transition(ctx, loan, "returned");
  },
});

// ── Queries ─────────────────────────────────────────────────────────

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", me._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").collect();
    return await Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});

// ── Helpers ─────────────────────────────────────────────────────────

// Loads a loan and checks the caller is its lender. Admins can view all loans
// but deliberately cannot act on someone else's.
async function getLoanAsLender(ctx: MutationCtx, loanId: Id<"loans">) {
  const me = await requireUser(ctx);
  const loan = await ctx.db.get(loanId);
  if (!loan) throw appError("NOT_FOUND", "Request not found.");
  if (loan.lenderId !== me._id) {
    throw appError("FORBIDDEN", "Only the owner of the tool can do this.");
  }
  return loan;
}

// What the UI gets for a loan: names only, never the other party's email.
async function toLoanView(ctx: QueryCtx, loan: Doc<"loans">) {
  const [tool, borrower, lender] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.borrowerId),
    ctx.db.get(loan.lenderId),
  ]);
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    status: loan.status,
    startDate: loan.startDate,
    endDate: loan.endDate,
    decidedAt: loan.decidedAt,
    returnedAt: loan.returnedAt,
    isOverdue: loan.status === "approved" && loan.endDate < todayIso(),
    tool: {
      _id: loan.toolId,
      name: tool?.name ?? "Unknown tool",
      category: tool?.category,
      removed: !tool || tool.removedAt !== undefined,
    },
    borrower: { _id: loan.borrowerId, name: borrower?.name ?? "Unknown" },
    lender: {
      _id: loan.lenderId,
      name: lender?.name ?? "Unknown",
      trustedLender: lender?.trustedLender ?? false,
    },
  };
}
