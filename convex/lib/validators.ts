import { v, type Infer } from "convex/values";

// Shared enums. The arrays are importable by the frontend (for selects/filters);
// the validators are used by the schema and by function args, so invalid
// values are rejected by Convex itself, not just by the UI.

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "ladders",
  "cleaning",
  "automotive",
  "camping",
  "other",
] as const;

export const CONDITIONS = ["new", "good", "fair", "worn"] as const;

export const ROLES = ["user", "admin"] as const;

export const LOAN_STATUSES = ["pending", "approved", "declined", "returned", "cancelled"] as const;

export const AUTOMATION_EVENT_TYPES = [
  "request_notification",
  "overdue_reminder",
  "workflow_error",
] as const;

export const AUTOMATION_EVENT_STATUSES = ["sent", "failed"] as const;

const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((value) => v.literal(value)));

export const vCategory = literals(CATEGORIES);
export const vCondition = literals(CONDITIONS);
export const vRole = literals(ROLES);
export const vLoanStatus = literals(LOAN_STATUSES);
export const vAutomationEventType = literals(AUTOMATION_EVENT_TYPES);
export const vAutomationEventStatus = literals(AUTOMATION_EVENT_STATUSES);

export type Category = Infer<typeof vCategory>;
export type Condition = Infer<typeof vCondition>;
export type Role = Infer<typeof vRole>;
export type LoanStatus = Infer<typeof vLoanStatus>;
export type AutomationEventType = Infer<typeof vAutomationEventType>;

// Text limits, enforced in mutations (Phase 2).
export const LIMITS = {
  toolName: 80,
  toolDescription: 500,
} as const;
