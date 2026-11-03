"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { CATEGORY_LABELS, formatRange, STATUS_LABELS, timeAgo } from "@/lib/format";
import { Badge, Card } from "./ui";

export type LoanView = FunctionReturnType<typeof api.loans.myRequests>[number];

export function StatusBadge({ loan }: { loan: LoanView }) {
  if (loan.isOverdue) return <Badge tone="red">Overdue</Badge>;
  const tone = { pending: "amber", approved: "green", declined: "neutral", returned: "blue" } as const;
  return <Badge tone={tone[loan.status]}>{STATUS_LABELS[loan.status]}</Badge>;
}

// One loan as a row. `counterpart` says whose name to show (the other party),
// `actions` holds whatever buttons the current view allows.
export function LoanCard({
  loan,
  counterpart,
  actions,
}: {
  loan: LoanView;
  counterpart: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card className="flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{loan.tool.name}</h3>
          <StatusBadge loan={loan} />
          {loan.tool.removed && <Badge>Listing removed</Badge>}
        </div>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {formatRange(loan.startDate, loan.endDate)}
          {loan.tool.category && ` · ${CATEGORY_LABELS[loan.tool.category]}`} · {counterpart}
        </p>
        <p className="mt-1 text-xs text-stone-400">{activityLine(loan)}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );
}

function activityLine(loan: LoanView): string {
  if (loan.returnedAt) return `Returned ${timeAgo(loan.returnedAt)}`;
  if (loan.decidedAt) return `${STATUS_LABELS[loan.status]} ${timeAgo(loan.decidedAt)}`;
  return `Requested ${timeAgo(loan._creationTime)}`;
}

export function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
        {title} <span className="font-normal">({count})</span>
      </h2>
      {children}
    </section>
  );
}
