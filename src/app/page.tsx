import { Suspense } from "react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";

// Phase 0 placeholder: proves Clerk is wired. The real landing page
// (public tool list from Convex) is built in Phase 3.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">LendLoop</h1>
      <p className="text-zinc-600">Borrow what you need, lend what you don&apos;t.</p>
      {/* <Show> reads the session (request data), so it streams in behind
          Suspense while the static shell prerenders (Cache Components). */}
      <Suspense fallback={<div className="h-10" />}>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="rounded-full bg-zinc-900 px-5 py-2 text-white hover:bg-zinc-700">
              Sign in to lend or borrow
            </button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </Suspense>
    </main>
  );
}
