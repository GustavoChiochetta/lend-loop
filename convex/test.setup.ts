/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addDays, todayIso } from "./lib/dates";
import schema from "./schema";

// Shared fixtures for the Convex function tests. Files with more than one dot
// (like this one and *.test.ts) are not deployed by Convex.

export const modules = import.meta.glob(["./**/*.*s", "!./**/*.*.*s"]);

export const ADMIN_EMAIL = "admin@example.com";

export function setup() {
  return convexTest(schema, modules);
}

type TestConvex = ReturnType<typeof setup>;

// Simulates a Clerk sign-in followed by the client's users.ensure call.
export async function signIn(
  t: TestConvex,
  name: string,
  { email = `${name}@example.com`, emailVerified = true } = {},
) {
  const as = t.withIdentity({
    subject: name,
    tokenIdentifier: `https://clerk.test|${name}`,
    name,
    email,
    emailVerified,
  });
  const id = await as.mutation(api.users.ensure, {});
  return { as, id };
}

export type SignedIn = Awaited<ReturnType<typeof signIn>>;

export async function createTool(user: SignedIn, overrides: { name?: string; category?: "garden" | "power_tools" } = {}) {
  return await user.as.mutation(api.tools.create, {
    name: overrides.name ?? "Cordless drill",
    category: overrides.category ?? "power_tools",
    condition: "good",
    description: "18V, two batteries.",
  });
}

export async function requestLoan(
  user: SignedIn,
  toolId: Id<"tools">,
  fromToday: number,
  toToday: number,
) {
  return await user.as.mutation(api.loans.request, {
    toolId,
    startDate: day(fromToday),
    endDate: day(toToday),
  });
}

// Date relative to today, e.g. day(0) = today, day(3) = in three days.
export function day(offset: number) {
  return addDays(todayIso(), offset);
}

// Matches a rejected ConvexError by its application error code.
export function withCode(code: string) {
  return { data: expect.objectContaining({ code }) };
}
