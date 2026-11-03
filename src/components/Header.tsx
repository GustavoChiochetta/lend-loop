"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "./AppGate";
import { Badge } from "./ui";

const LINKS = [
  { href: "/tools", label: "Tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming" },
];

export function Header() {
  const pathname = usePathname();
  const me = useMe();
  const links = me.role === "admin" ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;

  return (
    <header className="border-b border-stone-200 bg-white/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Lend<span className="text-emerald-700 dark:text-emerald-500">Loop</span>
        </Link>
        <nav className="order-last -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {links.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                  active
                    ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-50"
                    : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {me.trustedLender && <Badge tone="blue">Trusted Lender</Badge>}
          {me.role === "admin" && <Badge tone="amber">Admin</Badge>}
          <UserButton />
        </div>
      </div>
    </header>
  );
}
