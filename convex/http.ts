import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { isIsoDate, todayIso } from "./lib/dates";
import { verifyRequest } from "./lib/hmac";
import { isAutomationEventStatus, LIMITS, type AutomationEventStatus } from "./lib/validators";

// No body on rejection: an unauthenticated caller learns nothing about why.
const unauthorized = () => new Response(null, { status: 401 });
const badRequest = () => new Response(null, { status: 400 });

const http = httpRouter();

// The only way to register a route: the handler runs after the signature checks out,
// and fails closed when the secret isn't configured.
function signedRoute(
  method: "GET" | "POST",
  path: string,
  handler: (ctx: ActionCtx, body: string) => Promise<Response>,
) {
  http.route({
    path,
    method,
    handler: httpAction(async (ctx, req) => {
      const body = await req.text();
      const secret = process.env.N8N_HMAC_SECRET;
      if (!secret || !(await verifyRequest(secret, req, body))) return unauthorized();
      return await handler(ctx, body);
    }),
  });
}

signedRoute("GET", "/overdue-loans", async (ctx) =>
  Response.json(await ctx.runQuery(internal.automation.overdue, { today: todayIso() })),
);

signedRoute("POST", "/reminder-status", async (ctx, raw) => {
  const reminder = parseReminder(raw);
  if (!reminder) return badRequest();
  const ok = await ctx.runMutation(internal.automation.recordReminder, reminder);
  return ok ? Response.json({ ok: true }) : badRequest();
});

signedRoute("POST", "/workflow-error", async (ctx, raw) => {
  const report = parseWorkflowError(raw);
  if (!report) return badRequest();
  await ctx.runMutation(internal.automation.recordWorkflowError, report);
  return Response.json({ ok: true });
});

type Reminder = { loanId: string; date: string; status: AutomationEventStatus; detail?: string };

// The fields of a JSON object body, each still unchecked; null for anything else.
function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(raw);
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseReminder(raw: string): Reminder | null {
  const body = parseObject(raw);
  if (!body) return null;
  const { loanId, date, status, detail } = body;
  if (typeof loanId !== "string" || typeof date !== "string" || !isIsoDate(date)) return null;
  if (!isAutomationEventStatus(status)) return null;
  if (detail === undefined) return { loanId, date, status };
  if (typeof detail !== "string" || detail.length > LIMITS.automationDetail) return null;
  return { loanId, date, status, detail };
}

type WorkflowError = { executionId: string; workflow: string; node?: string; message: string; loanId?: string };

function parseWorkflowError(raw: string): WorkflowError | null {
  const body = parseObject(raw);
  if (!body) return null;
  const { executionId, workflow, node, message, loanId } = body;
  if (typeof executionId !== "string" || executionId.length === 0 || executionId.length > LIMITS.executionId) return null;
  if (typeof workflow !== "string" || workflow.length === 0) return null;
  if (typeof message !== "string" || message.length > LIMITS.automationDetail) return null;
  if (node !== undefined && typeof node !== "string") return null;
  if (loanId !== undefined && typeof loanId !== "string") return null;
  return { executionId, workflow, node, message, loanId };
}

export default http;
