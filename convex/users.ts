import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, isAdminEmail, requireAdmin } from "./lib/auth";
import { appError } from "./lib/errors";

// Called by the client right after sign-in. Creates or refreshes the user row
// and (re)computes the role from ADMIN_EMAILS, so ADMIN_EMAILS stays the single
// source of truth: removing an email from it demotes that user on next sign-in.
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw appError("UNAUTHENTICATED", "You need to sign in first.");
    }

    const email = identity.email ?? "";
    const name = identity.name || identity.givenName || email.split("@")[0] || "Neighbor";
    // Only a verified email can grant admin; otherwise anyone could sign up
    // with an admin's address on a provider that does not verify it.
    const role = identity.emailVerified === true && email && isAdminEmail(email) ? "admin" : "user";

    const existing = await getCurrentUser(ctx);
    if (existing) {
      if (existing.email !== email || existing.name !== name || existing.role !== role) {
        await ctx.db.patch(existing._id, { email, name, role });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email,
      name,
      role,
      trustedLender: false,
    });
  },
});

// The signed-in user's own profile (null when signed out / not yet ensured).
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw appError("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});
