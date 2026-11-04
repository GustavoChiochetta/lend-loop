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

export async function transition(ctx: MutationCtx, loan: Doc<"loans">, to: LoanStatus) {
  if (!NEXT[loan.status].includes(to)) {
    throw appError("CONFLICT", `This request is ${loan.status} and can't become ${to}.`);
  }
  const now = Date.now();
  await ctx.db.patch(loan._id, {
    status: to,
    ...(to === "returned" ? { returnedAt: now } : { decidedAt: now }),
  });
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
