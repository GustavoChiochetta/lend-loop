import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { getLoans, hasStarted } from "./availability";
import { appError } from "./errors";
import type { LoanStatus } from "./validators";

const NEXT: Record<LoanStatus, readonly LoanStatus[]> = {
  pending: ["approved", "declined", "cancelled"],
  approved: ["returned", "cancelled"],
  declined: [],
  returned: [],
  cancelled: [],
};

// Loans enter every status through this module, so every entry notifies (the demo seed skips it on purpose).
function notify(ctx: MutationCtx, loanId: Id<"loans">, status: LoanStatus) {
  return ctx.scheduler.runAfter(0, internal.notifications.send, { loanId, status });
}

// Only what a new request carries: decision and return times can't be set at creation.
type NewLoan = Pick<Doc<"loans">, "toolId" | "borrowerId" | "lenderId" | "startDate" | "endDate">;

export async function openLoan(ctx: MutationCtx, fields: NewLoan) {
  const loanId = await ctx.db.insert("loans", { ...fields, status: "pending" });
  await notify(ctx, loanId, "pending");
  return loanId;
}

export async function transition(ctx: MutationCtx, loan: Doc<"loans">, to: LoanStatus) {
  if (!NEXT[loan.status].includes(to)) {
    throw appError("CONFLICT", `This request is ${loan.status} and can't become ${to}.`);
  }
  const now = Date.now();
  await ctx.db.patch(loan._id, {
    status: to,
    ...(to === "returned" ? { returnedAt: now } : { decidedAt: now }),
  });
  await notify(ctx, loan._id, to);
}

export async function cancelLoansOfRemovedTool(ctx: MutationCtx, toolId: Id<"tools">, today: string) {
  const [pending, approved] = await Promise.all([
    getLoans(ctx, toolId, "pending"),
    getLoans(ctx, toolId, "approved"),
  ]);
  const doomed = [...pending, ...approved.filter((loan) => !hasStarted(loan, today))];
  for (const loan of doomed) {
    await transition(ctx, loan, "cancelled");
  }
}
