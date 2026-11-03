import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { appError } from "./errors";

// Every public function resolves the caller through these helpers.
// Identity comes from the Clerk JWT that Convex has already verified;
// the role comes from our own `users` table, never from the client.
// (MutationCtx extends QueryCtx, so these work in mutations too.)

export async function getCurrentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    // Either signed out, or signed in but users.ensure has not run yet.
    throw appError("UNAUTHENTICATED", "You need to sign in first.");
  }
  return user;
}

export async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw appError("FORBIDDEN", "Admins only.");
  }
  return user;
}

// ADMIN_EMAILS is a Convex deployment env var (comma-separated).
export function isAdminEmail(email: string): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
