"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { LoanStatus } from "@convex/lib/validators";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/AppGate";
import { LoanCard, Section } from "@/components/loans";
import { Badge, Button, Card, EmptyState, ErrorText, Loading, PageHeader, useRun } from "@/components/ui";
import { STATUS_LABELS } from "@/lib/format";

type UserRow = FunctionReturnType<typeof api.users.list>[number];
type LoanFilter = LoanStatus | "overdue" | "all";

export function AdminView() {
  const me = useMe();
  // Hiding the page is UX only; users.list / loans.listAll reject non-admins.
  if (me.role !== "admin") {
    return <EmptyState>This page is for admins only.</EmptyState>;
  }
  return <AdminDashboard />;
}

function AdminDashboard() {
  const users = useQuery(api.users.list);
  const loans = useQuery(api.loans.listAll);
  const [filter, setFilter] = useState<LoanFilter>("all");

  if (users === undefined || loans === undefined) return <Loading />;

  const visibleLoans = loans.filter((loan) =>
    filter === "all" ? true : filter === "overdue" ? loan.isOverdue : loan.status === filter,
  );
  const filters: LoanFilter[] = ["all", "pending", "approved", "overdue", "returned", "declined", "cancelled"];

  return (
    <>
      <PageHeader
        title="Admin"
        description="Every loan in the neighborhood, and who can be trusted with them."
        action={
          <Link href="/tools" className="text-sm text-stone-500 underline">
            Remove listings from the Tools page
          </Link>
        }
      />

      <Section title="Members" count={users.length}>
        <Card className="divide-y divide-stone-200 p-0 dark:divide-stone-800">
          {users.map((user) => (
            <UserRowView key={user._id} user={user} />
          ))}
        </Card>
      </Section>

      <Section title="All loans" count={loans.length}>
        <div className="mb-3 flex flex-wrap gap-2">
          {filters.map((f) => (
            <Button key={f} variant={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "overdue" ? "Overdue" : STATUS_LABELS[f]}
            </Button>
          ))}
        </div>
        {visibleLoans.length === 0 ? (
          <EmptyState>No loans match this filter.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {visibleLoans.map((loan) => (
              <li key={loan._id}>
                <LoanCard loan={loan} counterpart={<>{loan.lender.name} → {loan.borrower.name}</>} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function UserRowView({ user }: { user: UserRow }) {
  const setTrusted = useMutation(api.users.setTrustedLender);
  const { run, pending, error } = useRun();

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{user.name}</span>
          {user.role === "admin" && <Badge tone="amber">Admin</Badge>}
          {user.trustedLender && <Badge tone="blue">Trusted Lender</Badge>}
        </div>
        <p className="truncate text-sm text-stone-500">{user.email}</p>
        <ErrorText>{error}</ErrorText>
      </div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => run(() => setTrusted({ userId: user._id, trusted: !user.trustedLender }))}
      >
        {user.trustedLender ? "Remove Trusted" : "Mark Trusted Lender"}
      </Button>
    </div>
  );
}
