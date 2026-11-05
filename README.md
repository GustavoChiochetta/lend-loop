This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

For how the app, Convex and the n8n workflows connect, see [docs/architecture.md](docs/architecture.md).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## n8n integration (Phase 4)

Convex and n8n talk over HMAC-SHA256 signed requests. Both directions use the same scheme: header `X-LendLoop-Timestamp` (unix seconds, ±300s window) and header `X-LendLoop-Signature: sha256=<hex>`, computed over `${timestamp}\n${METHOD}\n${path}\n${body}`.

- **Convex → n8n.** Every new request and every status change POSTs to `N8N_WEBHOOK_URL`. The result is recorded in `automationEvents` (`notify:<loanId>:<status>`).
- **n8n → Convex.** `GET /overdue-loans` and `POST /reminder-status` live on the Convex site URL (`:3211` locally).

Create `.env.n8n` (git-ignored, never loaded by Next.js) and give Convex the same secret:

```bash
SECRET=$(openssl rand -hex 32)
printf 'N8N_HMAC_SECRET=%s\nCONVEX_SITE_URL=http://host.docker.internal:3211\n' "$SECRET" > .env.n8n
npx convex env set N8N_HMAC_SECRET "$SECRET"
npx convex env set N8N_WEBHOOK_URL http://localhost:5678/webhook/loan-notification
```

```bash
docker compose up -d   # n8n on :5678, Mailpit UI on :8025
```

Every attempt is recorded in the `automationEvents` table.

Try the Convex endpoints without n8n (Node 22, reads `.env.n8n`):

```bash
eval "$(npm run -s sign -- GET /overdue-loans)"
```

## n8n workflows (Phase 5)

Three workflows send every email. They live in `n8n/workflows/` as JSON. [docs/architecture.md](docs/architecture.md) has the diagrams and the reasons behind each choice.

| Workflow | Starts on | Does |
|---|---|---|
| WF1 Request Notification | Signed `POST /webhook/loan-notification` from Convex | Emails the lender about a new request and the borrower about every decision. Answers 401 to a bad signature and 502 with the reason when the email fails. |
| WF2 Overdue Reminders | Every day at 09:00 UTC, or a signed `POST /webhook/overdue-run` | Asks Convex for overdue loans, emails each borrower, and reports each result back. Sends at most one reminder per loan per day. |
| WF3 Error Handler | Any failed WF1 or WF2 execution | Emails `ADMIN_ALERT_EMAIL` and records a `workflow_error` row in Convex. |

### Setup

1. Add the two Phase 5 values to `.env.n8n`, next to the Phase 4 ones:

   ```bash
   printf 'ADMIN_ALERT_EMAIL=admin@lendloop.test\nMAIL_FROM="LendLoop <no-reply@lendloop.test>"\n' >> .env.n8n
   ```

2. Start n8n and Mailpit, then open http://localhost:5678 once and create the n8n owner account. The account is local to the Docker volume.

   ```bash
   docker compose up -d
   ```

3. Load the workflows. The script creates the Mailpit SMTP credential, imports the three workflows, publishes them and restarts n8n. It is safe to rerun after any change to `n8n/workflows/`.

   ```bash
   npm run n8n:setup
   ```

4. Check everything end to end. `npx convex dev` must be running.

   ```bash
   npm run e2e:n8n
   ```

   It prints one `PASS` or `FAIL` line per step and stops at the first failure. Emails show up at http://localhost:8025.

To make WF2 send a reminder right away, create an overdue loan and trigger the run:

```bash
npx convex run seed:overdue
```

```bash
eval "$(npm run -s sign -- POST /webhook/overdue-run '{}' | sed 's#127.0.0.1:3211#localhost:5678#')"
```

### Changing a workflow

Edit it in the n8n editor, then write it back to git:

```bash
npm run n8n:export
```

The export keeps only `id`, `name`, `nodes`, `connections` and `settings`, because a raw export also carries the owner's name and email. `npm test` then checks every file for secrets, email addresses, missing retries and the signing format.

### Things that surprised me

- `n8n import:workflow` deactivates every workflow it imports, including ones it did not change. `npm run n8n:setup` publishes every workflow in `n8n/workflows/` again for that reason.
- After a restart, the first request can still run the previous version of a workflow. A second request runs the new one.
- Once, an import right after the files were written reported 0 workflows. Running it again worked.
- With SMTP down, WF1 answers only after its three email tries, which took about 25 seconds. Convex waits up to 30 seconds before recording a timeout.
