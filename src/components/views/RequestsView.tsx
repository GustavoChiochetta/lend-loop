"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Link from "next/link";
import { LoanCard } from "@/components/loans";
import { EmptyState, Loading, PageHeader } from "@/components/ui";

export function RequestsView() {
  const loans = useQuery(api.loans.myRequests);

  return (
    <>
      <PageHeader title="My requests" description="Tools you asked to borrow, and where each request stands." />
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <EmptyState>
          No requests yet.{" "}
          <Link href="/tools" className="font-medium text-emerald-700 underline dark:text-emerald-500">
            Browse tools
          </Link>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => (
            <li key={loan._id}>
              <LoanCard
                loan={loan}
                counterpart={
                  <>
                    from {loan.lender.name}
                    {loan.lender.trustedLender && " (Trusted Lender)"}
                  </>
                }
              />
              {loan.isOverdue && (
                <p className="mt-1 px-1 text-sm text-red-700 dark:text-red-400">
                  This was due back — please return it to {loan.lender.name}.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
