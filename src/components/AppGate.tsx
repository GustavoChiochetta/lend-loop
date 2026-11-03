"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, type ReactNode } from "react";
import { Loading } from "./ui";

type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;

const MeContext = createContext<Me | null>(null);

// Signed-in pages render only once Convex has accepted the Clerk token AND
// users.ensure has created our user row. Otherwise every query below would
// race the ensure call and fail with UNAUTHENTICATED.
export function AppGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");

  if (isLoading || !isAuthenticated || !me) return <Loading />;
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside <AppGate>");
  return me;
}
