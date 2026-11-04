import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Everything n8n may learn about a loan's people: the recipient's own name and
// email plus the tool's name. Never the other party's email.
export async function loanContact(ctx: QueryCtx, loan: Doc<"loans">, who: "lenderId" | "borrowerId") {
  const [person, tool] = await Promise.all([ctx.db.get(loan[who]), ctx.db.get(loan.toolId)]);
  if (!person || !tool) return null;
  return { recipient: { email: person.email, name: person.name }, tool: { name: tool.name } };
}
