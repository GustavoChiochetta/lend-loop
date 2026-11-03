"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { LoanCard, Section, type LoanView } from "@/components/loans";
import { Button, EmptyState, ErrorText, Loading, PageHeader, useRun } from "@/components/ui";

export function IncomingView() {
  const loans = useQuery(api.loans.incoming);

  if (loans === undefined) return <Loading />;

  const pending = loans.filter((l) => l.status === "pending");
  const active = loans.filter((l) => l.status === "approved");
  const history = loans.filter((l) => l.status === "declined" || l.status === "returned");

  return (
    <>
      <PageHeader title="Incoming requests" description="Requests to borrow your tools." />
      {loans.length === 0 ? (
        <EmptyState>No one has asked to borrow your tools yet.</EmptyState>
      ) : (
        <>
          <Section title="Waiting for you" count={pending.length}>
            <LoanList loans={pending} empty="Nothing to review." />
          </Section>
          <Section title="Lent out" count={active.length}>
            <LoanList loans={active} empty="None of your tools are out right now." />
          </Section>
          <Section title="History" count={history.length}>
            <LoanList loans={history} empty="No past requests." />
          </Section>
        </>
      )}
    </>
  );
}

function LoanList({ loans, empty }: { loans: LoanView[]; empty: string }) {
  if (loans.length === 0) return <p className="text-sm text-stone-500">{empty}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {loans.map((loan) => (
        <li key={loan._id}>
          <IncomingLoan loan={loan} />
        </li>
      ))}
    </ul>
  );
}

function IncomingLoan({ loan }: { loan: LoanView }) {
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);
  const { run, pending, error } = useRun();

  const actions =
    loan.status === "pending" ? (
      <>
        <Button disabled={pending} onClick={() => run(() => approve({ loanId: loan._id }))}>
          Approve
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => run(() => decline({ loanId: loan._id }))}>
          Decline
        </Button>
      </>
    ) : loan.status === "approved" ? (
      <Button variant="secondary" disabled={pending} onClick={() => run(() => markReturned({ loanId: loan._id }))}>
        Mark returned
      </Button>
    ) : undefined;

  return (
    <>
      <LoanCard loan={loan} counterpart={<>to {loan.borrower.name}</>} actions={actions} />
      <div className="px-1 pt-1">
        <ErrorText>{error}</ErrorText>
      </div>
    </>
  );
}
