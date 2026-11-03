"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { addDays, MAX_LOAN_DAYS, todayIso } from "@convex/lib/dates";
import { CATEGORIES, type Category } from "@convex/lib/validators";
import type { FunctionReturnType } from "convex/server";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/AppGate";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorText,
  Field,
  inputClass,
  Loading,
  PageHeader,
  useRun,
} from "@/components/ui";
import { CATEGORY_LABELS, CONDITION_LABELS, formatRange } from "@/lib/format";

type ToolView = FunctionReturnType<typeof api.tools.list>[number];

export function ToolsView() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.list, { category });

  return (
    <>
      <PageHeader title="Tools" description="Everything your neighbors are lending right now." />

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <FilterChip active={!category} onClick={() => setCategory(undefined)}>
          All
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABELS[c]}
          </FilterChip>
        ))}
      </div>

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState>
          {category ? `No ${CATEGORY_LABELS[category].toLowerCase()} listed yet.` : "No tools listed yet."}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool._id}>
              <ToolCard tool={tool} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-emerald-700 bg-emerald-700 text-white dark:border-emerald-600 dark:bg-emerald-600"
          : "border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
      }`}
    >
      {children}
    </button>
  );
}

function ToolCard({ tool }: { tool: ToolView }) {
  const me = useMe();
  const [requesting, setRequesting] = useState(false);
  const [sent, setSent] = useState(false);
  const remove = useMutation(api.tools.remove);
  const { run, pending, error } = useRun();

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{tool.name}</h3>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {tool.isMine ? "Your listing" : `Lent by ${tool.owner.name}`}
            {tool.owner.trustedLender && (
              <span className="ml-2">
                <Badge tone="blue">Trusted Lender</Badge>
              </span>
            )}
          </p>
        </div>
        {tool.availability === "available" ? (
          <Badge tone="green">Available</Badge>
        ) : (
          <Badge tone="amber">On loan</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge>{CATEGORY_LABELS[tool.category]}</Badge>
        <Badge>Condition: {CONDITION_LABELS[tool.condition]}</Badge>
      </div>

      {tool.description && <p className="text-sm text-stone-700 dark:text-stone-300">{tool.description}</p>}

      {tool.bookedRanges.length > 0 && (
        <p className="text-xs text-stone-500">
          Booked: {tool.bookedRanges.map((r) => formatRange(r.startDate, r.endDate)).join(", ")}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-1">
        {sent && !requesting && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Request sent. Track it under My requests.
          </p>
        )}
        {requesting ? (
          <RequestForm
            toolId={tool._id}
            onCancel={() => setRequesting(false)}
            onSent={() => {
              setRequesting(false);
              setSent(true);
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {!tool.isMine && (
              <Button onClick={() => { setSent(false); setRequesting(true); }}>Request to borrow</Button>
            )}
            {me.role === "admin" && !tool.isMine && (
              <ConfirmButton
                prompt="Remove this listing?"
                confirmLabel="Yes, remove"
                onConfirm={() => run(() => remove({ toolId: tool._id }))}
                disabled={pending}
              >
                Remove (admin)
              </ConfirmButton>
            )}
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}

function RequestForm({ toolId, onCancel, onSent }: { toolId: Id<"tools">; onCancel: () => void; onSent: () => void }) {
  // Same UTC "today" as the server, so the picker can't offer a day it rejects.
  const today = todayIso();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 1));
  const request = useMutation(api.loans.request);
  const { run, pending, error } = useRun();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => request({ toolId, startDate, endDate }))) onSent();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg bg-stone-50 p-3 dark:bg-stone-950">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input
            type="date"
            required
            className={inputClass}
            value={startDate}
            min={today}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (endDate < e.target.value) setEndDate(e.target.value);
            }}
          />
        </Field>
        <Field label="Until">
          <input
            type="date"
            required
            className={inputClass}
            value={endDate}
            min={startDate}
            max={startDate ? addDays(startDate, MAX_LOAN_DAYS - 1) : undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send request"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
