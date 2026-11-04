import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { loanContact } from "./lib/contacts";
import { recordEvent, wasSent } from "./lib/events";
import { signedHeaders } from "./lib/hmac";
import { vAutomationEventStatus, vLoanStatus, type LoanStatus } from "./lib/validators";

const TIMEOUT_MS = 10_000;

type NotificationEvent = "loan.requested" | "loan.status_changed";

// Who hears about each status: the lender learns of new requests, the borrower of every decision.
const AUDIENCE: Record<LoanStatus, { to: "lenderId" | "borrowerId"; event: NotificationEvent }> = {
  pending: { to: "lenderId", event: "loan.requested" },
  approved: { to: "borrowerId", event: "loan.status_changed" },
  declined: { to: "borrowerId", event: "loan.status_changed" },
  cancelled: { to: "borrowerId", event: "loan.status_changed" },
  returned: { to: "borrowerId", event: "loan.status_changed" },
};

type NotificationPayload = {
  event: NotificationEvent;
  loanId: Id<"loans">;
  status: LoanStatus;
  recipient: { email: string; name: string };
  tool: { name: string };
  startDate: string;
  endDate: string;
};

// Explicit return types here and in `send` break the inference cycle through `internal.notifications`.
export const payload = internalQuery({
  args: { loanId: v.id("loans"), status: vLoanStatus },
  handler: async (ctx, { loanId, status }): Promise<NotificationPayload | null> => {
    if (await wasSent(ctx, { kind: "notify", loanId, status })) return null;
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const { to, event } = AUDIENCE[status];
    const contact = await loanContact(ctx, loan, to);
    if (!contact) return null;
    return { event, loanId, status, ...contact, startDate: loan.startDate, endDate: loan.endDate };
  },
});

export const record = internalMutation({
  args: { loanId: v.id("loans"), status: vLoanStatus, outcome: vAutomationEventStatus, detail: v.optional(v.string()) },
  handler: async (ctx, { loanId, status, outcome, detail }) => {
    await recordEvent(ctx, { kind: "notify", loanId, status }, outcome, detail);
  },
});

// Returns why the delivery failed, or undefined when n8n accepted it.
async function deliver(body: NotificationPayload): Promise<string | undefined> {
  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_HMAC_SECRET;
  if (!url) return "N8N_WEBHOOK_URL not set";
  if (!secret) return "N8N_HMAC_SECRET not set";

  const json = JSON.stringify(body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await signedHeaders(secret, "POST", new URL(url).pathname, json)),
      },
      body: json,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? undefined : `n8n responded ${res.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// Scheduled by the mutation that changed the loan, so it only runs if that mutation committed.
// No retry here: a failure is recorded and n8n owns retries.
export const send = internalAction({
  args: { loanId: v.id("loans"), status: vLoanStatus },
  handler: async (ctx, { loanId, status }): Promise<void> => {
    const body: NotificationPayload | null = await ctx.runQuery(internal.notifications.payload, { loanId, status });
    if (!body) return;
    const detail = await deliver(body);
    await ctx.runMutation(internal.notifications.record, { loanId, status, outcome: detail ? "failed" : "sent", detail });
  },
});
