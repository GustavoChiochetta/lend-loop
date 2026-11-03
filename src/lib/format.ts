import { ConvexError } from "convex/values";
import type { Category, Condition, LoanStatus } from "@convex/lib/validators";

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  ladders: "Ladders",
  cleaning: "Cleaning",
  automotive: "Automotive",
  camping: "Camping",
  other: "Other",
};

export const CONDITION_LABELS: Record<Condition, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  worn: "Worn",
};

export const STATUS_LABELS: Record<LoanStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  returned: "Returned",
};

// Loan dates are UTC calendar days ("YYYY-MM-DD"); format them in UTC too
// so a date never shifts by one in timezones behind UTC.
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function formatDay(isoDate: string): string {
  return dayFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatRange(startDate: string, endDate: string): string {
  return startDate === endDate
    ? formatDay(startDate)
    : `${formatDay(startDate)} – ${formatDay(endDate)}`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(timestamp: number, now = Date.now()): string {
  const minutes = Math.round((timestamp - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

// Application errors (ConvexError) carry a user-facing message; anything else
// is unexpected and shown generically (Convex redacts internals in prod anyway).
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  return "Something went wrong. Please try again.";
}
