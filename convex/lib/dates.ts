import { appError } from "./errors";

// Loan dates are calendar days ("YYYY-MM-DD", UTC). ISO dates sort and
// compare correctly as plain strings, which the overlap/overdue logic relies on.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_LOAN_DAYS = 30;

export function todayIso(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function assertIsoDate(value: string, field: string): void {
  // The round-trip rejects impossible dates such as 2026-02-31.
  if (!ISO_DATE.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw appError("INVALID_INPUT", `${field} must be a valid date (YYYY-MM-DD).`);
  }
}

// Inclusive ranges: a loan ending on the 5th blocks another starting on the 5th.
export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
