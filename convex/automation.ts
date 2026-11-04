import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { loanContact } from "./lib/contacts";
import { daysBetween } from "./lib/dates";
import { recordEvent, wasSent } from "./lib/events";
import { vAutomationEventStatus } from "./lib/validators";

// Approved loans past their end date that haven't had a reminder sent today,
// so n8n can rerun the daily workflow without emailing anyone twice.
export const overdue = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", today))
      .collect();

    const result = [];
    for (const loan of loans) {
      if (await wasSent(ctx, { kind: "reminder", loanId: loan._id, date: today })) continue;
      const contact = await loanContact(ctx, loan, "borrowerId");
      if (!contact) continue;
      result.push({
        loanId: loan._id,
        borrower: contact.recipient,
        tool: contact.tool,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return { date: today, loans: result };
  },
});

// Returns false when the loan doesn't exist, so the HTTP layer can answer 400.
export const recordReminder = internalMutation({
  args: {
    loanId: v.string(),
    date: v.string(),
    status: vAutomationEventStatus,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { loanId: rawId, date, status, detail }) => {
    const loanId = ctx.db.normalizeId("loans", rawId);
    if (!loanId || !(await ctx.db.get(loanId))) return false;
    await recordEvent(ctx, { kind: "reminder", loanId, date }, status, detail);
    return true;
  },
});
