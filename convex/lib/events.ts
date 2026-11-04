import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AutomationEventStatus, AutomationEventType, LoanStatus } from "./validators";

// What an automation event is about. The kind is also the prefix of the stored
// idempotency key, so it must match the rows already written.
export type EventRef =
  | { kind: "notify"; loanId: Id<"loans">; status: LoanStatus }
  | { kind: "reminder"; loanId: Id<"loans">; date: string };

const TYPE: Record<EventRef["kind"], AutomationEventType> = {
  notify: "request_notification",
  reminder: "overdue_reminder",
};

function keyOf(ref: EventRef) {
  return `${ref.kind}:${ref.loanId}:${ref.kind === "notify" ? ref.status : ref.date}`;
}

async function find(ctx: QueryCtx, ref: EventRef) {
  return await ctx.db
    .query("automationEvents")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", keyOf(ref)))
    .unique();
}

export async function wasSent(ctx: QueryCtx, ref: EventRef) {
  return (await find(ctx, ref))?.status === "sent";
}

// One row per ref. A retry that succeeds upgrades failed -> sent; "sent" is final.
export async function recordEvent(ctx: MutationCtx, ref: EventRef, status: AutomationEventStatus, detail?: string) {
  const existing = await find(ctx, ref);
  if (!existing) {
    await ctx.db.insert("automationEvents", {
      loanId: ref.loanId,
      type: TYPE[ref.kind],
      idempotencyKey: keyOf(ref),
      status,
      detail,
    });
  } else if (existing.status === "failed") {
    await ctx.db.patch(existing._id, { status, detail });
  }
}
