import { auth } from "@clerk/nextjs/server";
import { Suspense, type ReactNode } from "react";
import { AppGate } from "@/components/AppGate";
import { Header } from "@/components/Header";

// Every page in this group requires a session. The session check reads request
// cookies, so it streams in its own Suspense boundary next to the content
// instead of wrapping it: the page shell stays prerenderable (Cache Components),
// and AppGate waits client-side until Convex knows the user.
// Redirecting signed-out visitors is UX only: Convex re-checks every call.
//
// Pages in this group render from live Convex queries on the client (AppGate
// renders nothing on the server), so each page sets `instant = false`: Next's
// instant-navigation validation has no server-rendered segment to check.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <RequireSession />
      </Suspense>
      <AppGate>
        <Header />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </AppGate>
    </>
  );
}

async function RequireSession() {
  await auth.protect();
  return null;
}
