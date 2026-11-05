#!/usr/bin/env node
// End-to-end check of the Phase 5 workflows against the local stack:
// Convex (`npx convex dev`), n8n and Mailpit (`docker compose up -d`).
// Run through `npm run e2e:n8n`, which loads .env.n8n.
import { execFileSync } from "node:child_process";
import { signedHeaders } from "../convex/lib/hmac.ts";

const N8N = "http://localhost:5678";
const MAILPIT = "http://localhost:8025/api/v1";
const CONVEX_SITE = "http://127.0.0.1:3211";
const { N8N_HMAC_SECRET: SECRET, ADMIN_ALERT_EMAIL: ADMIN } = process.env;
const RUN = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);

class Failure extends Error {}
const check = (ok, message) => {
  if (!ok) throw new Failure(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what, read, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    check(Date.now() < deadline, `timed out after ${timeoutMs / 1000}s waiting for ${what}`);
    await sleep(500);
  }
}

async function reachable(name, url, hint) {
  const res = await fetch(url).catch(() => undefined);
  check(res !== undefined, `${name} is not reachable at ${url}. ${hint}`);
}

async function emails() {
  const res = await fetch(`${MAILPIT}/messages?limit=500`);
  const { messages } = await res.json();
  return messages.map((m) => ({ to: m.To.map((t) => t.Address), subject: m.Subject }));
}
const emailsTo = async (address) => (await emails()).filter((m) => m.to.includes(address));

async function postSigned(path, body, { tamper = false } = {}) {
  const headers = await signedHeaders(SECRET, "POST", path, body);
  const sent = tamper ? body.replace("approved", "declined") : body;
  const res = await fetch(`${N8N}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: sent,
  });
  check(res.status !== 404, `n8n has no webhook at ${path}. Is the workflow imported and published?`);
  return res;
}

function convex(...args) {
  return execFileSync("npx", ["convex", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const automationEvents = () =>
  convex("data", "automationEvents", "--format", "jsonLines", "--limit", "1000")
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));

const approval = (email) =>
  JSON.stringify({
    event: "loan.status_changed",
    loanId: `e2e-${RUN}`,
    status: "approved",
    recipient: { email, name: "E2E" },
    tool: { name: `E2E drill ${RUN}` },
    startDate: today,
    endDate: today,
  });
const recipient = `e2e-${RUN}@lendloop.test`;

const steps = [
  {
    name: "prerequisites",
    async run() {
      check(SECRET, "N8N_HMAC_SECRET is not set. Fill in .env.n8n.");
      check(ADMIN, "ADMIN_ALERT_EMAIL is not set. Fill in .env.n8n.");
      await reachable("Convex", CONVEX_SITE, "Start it with `npx convex dev`.");
      await reachable("n8n", `${N8N}/healthz`, "Start it with `docker compose up -d`.");
      await reachable("Mailpit", `${MAILPIT}/info`, "Start it with `docker compose up -d`.");
    },
  },
  {
    name: "reset Mailpit",
    async run() {
      await fetch(`${MAILPIT}/messages`, { method: "DELETE" });
      check((await emails()).length === 0, "Mailpit still has messages after the reset");
    },
  },
  {
    name: "WF1 sends a signed notification",
    async run() {
      const res = await postSigned("/webhook/loan-notification", approval(recipient));
      check(res.status === 200, `expected 200 from WF1, got ${res.status}: ${await res.text()}`);
      const [mail, ...extra] = await until(`an email to ${recipient}`, async () => {
        const found = await emailsTo(recipient);
        return found.length ? found : undefined;
      });
      check(extra.length === 0, `expected one email to ${recipient}, got ${extra.length + 1}`);
      check(mail.subject === `Your request for E2E drill ${RUN} was approved`, `unexpected subject "${mail.subject}"`);
    },
  },
  {
    name: "WF1 rejects a tampered body",
    async run() {
      const before = (await emails()).length;
      const res = await postSigned("/webhook/loan-notification", approval(recipient), { tamper: true });
      check(res.status === 401, `expected 401 for a tampered body, got ${res.status}`);
      await sleep(2000);
      check((await emails()).length === before, "a tampered request still sent an email");
    },
  },
  {
    name: "WF2 reminds an overdue borrower once a day",
    async run() {
      const { loanId, borrowerEmail } = JSON.parse(convex("run", "seed:overdue"));
      const key = `reminder:${loanId}:${today}`;
      const before = (await emailsTo(borrowerEmail)).length;

      const res = await postSigned("/webhook/overdue-run", "{}");
      check(res.status === 202, `expected 202 from WF2, got ${res.status}`);
      const row = await until(`the ${key} row`, () => automationEvents().find((e) => e.idempotencyKey === key), 60_000);
      check(row.status === "sent", `${key} is ${row.status}: ${row.detail}`);
      const after = (await emailsTo(borrowerEmail)).length;
      check(after > before, `no reminder email reached ${borrowerEmail}`);

      check((await postSigned("/webhook/overdue-run", "{}")).status === 202, "second WF2 run was not accepted");
      await sleep(8000);
      check((await emailsTo(borrowerEmail)).length === after, "a second run on the same day sent another reminder");
    },
  },
  {
    name: "WF3 reports a failed workflow",
    async run() {
      const since = Date.now();
      const res = await postSigned("/webhook/loan-notification", approval("not-an-email"));
      check(res.status === 502, `expected 502 for an invalid recipient, got ${res.status}`);
      await until(`an alert to ${ADMIN}`, async () =>
        (await emailsTo(ADMIN)).some((m) => m.subject === "LendLoop workflow failed: Request Notification"),
      );
      const row = await until("a workflow_error row", () =>
        automationEvents().find((e) => e.type === "workflow_error" && e._creationTime >= since),
      );
      check(row.detail.startsWith("Request Notification / "), `unexpected detail "${row.detail}"`);
    },
  },
];

for (const step of steps) {
  try {
    await step.run();
    console.log(`PASS  ${step.name}`);
  } catch (error) {
    console.log(`FAIL  ${step.name}: ${error instanceof Failure ? error.message : error}`);
    process.exit(1);
  }
}
