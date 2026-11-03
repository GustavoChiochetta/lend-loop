"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useEffect, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL. See .env.example.");
}

const convex = new ConvexReactClient(convexUrl);

// Forwards the Clerk session token to Convex so every query/mutation
// can resolve the caller via ctx.auth.getUserIdentity().
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <EnsureUser />
      {children}
    </ConvexProviderWithClerk>
  );
}

// Once Convex has accepted the Clerk token, create/refresh our users row
// (and its role). Runs again whenever the auth state flips to signed-in.
function EnsureUser() {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);

  useEffect(() => {
    if (isAuthenticated) {
      ensure().catch((error) => console.error("users.ensure failed", error));
    }
  }, [isAuthenticated, ensure]);

  return null;
}
