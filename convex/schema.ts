import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vAutomationEventStatus,
  vAutomationEventType,
  vCategory,
  vCondition,
  vLoanStatus,
  vRole,
} from "./lib/validators";

// Dates for loans are stored as "YYYY-MM-DD" strings: a borrow period is a
// calendar range, not an instant, and ISO dates compare correctly as strings
// (used by the overdue query: endDate < today).

export default defineSchema({
  // Mirror of the Clerk user, created on first sign-in. Role lives here (server-side)
  // so authorization never depends on anything the client sends.
  users: defineTable({
    tokenIdentifier: v.string(), // from ctx.auth.getUserIdentity(); stable per issuer+user
    email: v.string(),
    name: v.string(),
    role: vRole,
    trustedLender: v.boolean(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    // Denormalized from the tool so "Incoming requests" is a single index lookup
    // and the lender's access check does not need to load the tool.
    lenderId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: vLoanStatus,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_endDate", ["status", "endDate"]),

  // Audit trail of everything the n8n workflows did (or failed to do) per loan.
  // Also powers the "Reminder sent 2 days ago" activity in the UI.
  automationEvents: defineTable({
    loanId: v.optional(v.id("loans")), // absent for workflow-level errors
    type: vAutomationEventType,
    status: vAutomationEventStatus,
    // Makes n8n write-backs idempotent: a retried call with the same key is a no-op.
    idempotencyKey: v.string(),
    detail: v.optional(v.string()),
  })
    .index("by_loan", ["loanId"])
    .index("by_idempotencyKey", ["idempotencyKey"]),
});
