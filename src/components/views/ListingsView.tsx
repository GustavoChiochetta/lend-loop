"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CATEGORIES, CONDITIONS, LIMITS, type Category, type Condition } from "@convex/lib/validators";
import type { FunctionReturnType } from "convex/server";
import { useState, type FormEvent } from "react";
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
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/lib/format";

type Listing = FunctionReturnType<typeof api.tools.myListings>[number];
type ToolInput = { name: string; category: Category; condition: Condition; description: string };

const EMPTY: ToolInput = { name: "", category: "power_tools", condition: "good", description: "" };

export function ListingsView() {
  const listings = useQuery(api.tools.myListings);
  const create = useMutation(api.tools.create);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="My listings"
        description="Tools you're lending to the neighborhood."
        action={!adding && <Button onClick={() => setAdding(true)}>+ List a tool</Button>}
      />

      {adding && (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">List a new tool</h2>
          <ToolForm
            initial={EMPTY}
            submitLabel="List tool"
            onSubmit={(values) => create(values)}
            onDone={() => setAdding(false)}
          />
        </Card>
      )}

      {listings === undefined ? (
        <Loading />
      ) : listings.length === 0 ? (
        !adding && <EmptyState>You haven&apos;t listed anything yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {listings.map((tool) => (
            <li key={tool._id}>
              <ListingRow tool={tool} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ListingRow({ tool }: { tool: Listing }) {
  const [editing, setEditing] = useState(false);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const { run, pending, error } = useRun();

  if (editing) {
    return (
      <Card>
        <ToolForm
          initial={tool}
          submitLabel="Save changes"
          onSubmit={(values) => update({ toolId: tool._id, ...values })}
          onDone={() => setEditing(false)}
        />
      </Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{tool.name}</h3>
          {tool.availability === "available" ? (
            <Badge tone="green">Available</Badge>
          ) : (
            <Badge tone="amber">On loan</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
          {tool.description && ` · ${tool.description}`}
        </p>
        <ErrorText>{error}</ErrorText>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <ConfirmButton
          prompt="Delete? Pending requests will be declined."
          onConfirm={() => run(() => remove({ toolId: tool._id }))}
          disabled={pending}
        >
          Delete
        </ConfirmButton>
      </div>
    </Card>
  );
}

function ToolForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
}: {
  initial: ToolInput;
  submitLabel: string;
  onSubmit: (values: ToolInput) => Promise<unknown>;
  onDone: () => void;
}) {
  const [values, setValues] = useState<ToolInput>({
    name: initial.name,
    category: initial.category,
    condition: initial.condition,
    description: initial.description,
  });
  const { run, pending, error } = useRun();
  const set = <K extends keyof ToolInput>(key: K, value: ToolInput[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => onSubmit(values))) onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Name">
          <input
            required
            className={inputClass}
            value={values.name}
            maxLength={LIMITS.toolName}
            placeholder="e.g. Cordless drill"
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Category">
        <select
          className={inputClass}
          value={values.category}
          onChange={(e) => set("category", e.target.value as Category)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Condition">
        <select
          className={inputClass}
          value={values.condition}
          onChange={(e) => set("condition", e.target.value as Condition)}
        >
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABELS[c]}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field
          label="Short description"
          hint={`${values.description.length}/${LIMITS.toolDescription}`}
        >
          <textarea
            rows={3}
            className={inputClass}
            value={values.description}
            maxLength={LIMITS.toolDescription}
            placeholder="Anything a borrower should know: accessories, quirks, pickup notes."
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
