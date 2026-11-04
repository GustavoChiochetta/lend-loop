import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { LoanStatus } from "./validators";
import { todayIso } from "./dates";

export type Availability = "available" | "on_loan";

export async function getLoans(ctx: QueryCtx, toolId: Id<"tools">, status: LoanStatus) {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", status))
    .collect();
}

export function hasStarted(loan: Doc<"loans">, today: string): boolean {
  return loan.startDate <= today;
}

export function availabilityOf(approved: Doc<"loans">[], today = todayIso()): Availability {
  return approved.some((loan) => hasStarted(loan, today)) ? "on_loan" : "available";
}
