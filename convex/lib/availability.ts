import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { todayIso } from "./dates";

export type Availability = "available" | "on_loan";

// Approved loans are the only ones that block a tool: pending requests are
// just intents, and declined/returned loans are history.
export async function getApprovedLoans(ctx: QueryCtx, toolId: Id<"tools">) {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

// A tool is "on loan" once an approved loan has started and until the lender
// marks it returned (even past endDate: an overdue tool is still not home).
export function availabilityOf(approved: Doc<"loans">[], today = todayIso()): Availability {
  return approved.some((loan) => loan.startDate <= today) ? "on_loan" : "available";
}
