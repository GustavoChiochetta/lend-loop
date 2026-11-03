"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CATEGORY_LABELS } from "@/lib/format";
import { Badge, EmptyState, Loading } from "./ui";

// Anonymous, read-only list. tools.listPublic only returns name + category.
export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);

  if (tools === undefined) return <Loading />;
  if (tools.length === 0) {
    return <EmptyState>No tools listed yet. Be the first to lend one!</EmptyState>;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool) => (
        <li
          key={tool._id}
          className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900"
        >
          <span className="truncate font-medium">{tool.name}</span>
          <Badge>{CATEGORY_LABELS[tool.category]}</Badge>
        </li>
      ))}
    </ul>
  );
}
