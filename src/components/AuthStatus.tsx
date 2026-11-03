"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Temporary checkpoint widget (removed in Phase 3): shows what Convex sees.
export function AuthStatus() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me);

  if (isLoading) return <p className="text-sm text-zinc-500">Convex: connecting…</p>;
  if (!isAuthenticated) return <p className="text-sm text-zinc-500">Convex: signed out</p>;
  if (!me) return <p className="text-sm text-zinc-500">Convex: creating your profile…</p>;
  return (
    <p className="text-sm text-zinc-500" data-testid="auth-status">
      Convex: signed in as {me.name} ({me.role})
    </p>
  );
}
