import { Suspense } from "react";
import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { PublicToolList } from "@/components/PublicToolList";

const primaryButton =
  "inline-flex rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <span className="text-lg font-semibold tracking-tight">
          Lend<span className="text-emerald-700 dark:text-emerald-500">Loop</span>
        </span>
        {/* Session-dependent UI streams in behind Suspense (Cache Components). */}
        <Suspense fallback={null}>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </Suspense>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4">
        <section className="py-16 text-center sm:py-24">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Borrow what you need.
            <br />
            <span className="text-emerald-700 dark:text-emerald-500">Lend what you don&apos;t.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-stone-600 dark:text-stone-400">
            LendLoop is your neighborhood tool shelf. Why buy a ladder you use twice a year when
            the neighbor three doors down has one?
          </p>
          <div className="mt-8 flex justify-center">
            <Suspense fallback={<div className="h-10" />}>
              <Show when="signed-out">
                <SignInButton mode="modal" forceRedirectUrl="/tools">
                  <button className={primaryButton}>Sign in to lend or borrow</button>
                </SignInButton>
              </Show>
              <Show when="signed-in">
                <Link href="/tools" className={primaryButton}>
                  Open LendLoop →
                </Link>
              </Show>
            </Suspense>
          </div>
        </section>

        <section className="pb-16">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Available in the neighborhood
          </h2>
          <PublicToolList />
        </section>
      </main>
    </div>
  );
}
