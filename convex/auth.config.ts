import type { AuthConfig } from "convex/server";

// Convex validates the Clerk-issued JWT ("convex" template) against this issuer.
// CLERK_JWT_ISSUER_DOMAIN is set in the Convex dashboard (not in .env.local).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
