# LendLoop

LendLoop is a neighborhood tool-lending board. Neighbors list tools they are willing to lend, request to borrow them for a date range, and get an email for every request, decision and overdue loan. The emails are sent by n8n workflows.

Built with Next.js (App Router), Clerk, Convex, n8n and TypeScript.

## What it does

- **Signed out:** the home page shows the tools that are available, with name and category only. It shows nothing about the owners.
- **Signed in:** list tools, browse all tools by category, request a tool for a date range, approve or decline requests for your own tools, and mark loans as returned. The pages are Tools, My listings, My requests and Incoming requests. Every loan shows its latest automation activity, such as when the last reminder was sent.
- **Admin:** remove any listing, see every loan, and mark a lender as Trusted Lender.
- **Automation:** WF1 emails the right person on every request and status change. WF2 runs daily and reminds borrowers of overdue loans. WF3 alerts the admin when either one fails.

## Local setup

You need Node 22 (`nvm use` reads `.nvmrc`), Docker, and a free Clerk account.

### 1. App, Convex and Clerk

```bash
npm install
```

```bash
npx convex dev
```

The first run creates a local Convex deployment and writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to `.env.local`. Leave it running.

In the Clerk dashboard, create an application, then go to **JWT templates** and add the **Convex** template. Its name must stay `convex`. Copy the API keys into `.env.local` (see `.env.example`) and give Convex the issuer and the admin emails:

```bash
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
```

```bash
npx convex env set ADMIN_EMAILS you@example.com
```

```bash
npm run dev
```

Open http://localhost:3000 and sign in. To get some neighbors, tools and requests to work with:

```bash
npx convex run seed:demo
```

### 2. n8n and Mailpit

Create `.env.n8n` and give Convex the same secret. The file is git-ignored and Next.js never loads it.

```bash
SECRET=$(openssl rand -hex 32)
cat > .env.n8n <<EOF
N8N_HMAC_SECRET=$SECRET
CONVEX_SITE_URL=http://host.docker.internal:3211
ADMIN_ALERT_EMAIL=admin@lendloop.test
MAIL_FROM="LendLoop <no-reply@lendloop.test>"
EOF
npx convex env set N8N_HMAC_SECRET "$SECRET"
npx convex env set N8N_WEBHOOK_URL http://localhost:5678/webhook/loan-notification
```

Start n8n (http://localhost:5678) and Mailpit (http://localhost:8025, where every email lands):

```bash
docker compose up -d
```

Open http://localhost:5678 once and create the n8n owner account. Then load the workflows. The script creates the Mailpit SMTP credential, imports the three workflows from `n8n/workflows/`, publishes them and restarts n8n. You can run it again after any change.

```bash
npm run n8n:setup
```

### 3. Check it

```bash
npm test
```

```bash
npm run e2e:n8n
```

`npm test` needs no running services. `npm run e2e:n8n` runs against the real stack with `npx convex dev` running, and prints one `PASS` or `FAIL` line per step.

To see an overdue reminder right away, create an overdue loan and start WF2 by hand:

```bash
npx convex run seed:overdue
```

```bash
eval "$(npm run -s sign -- POST /webhook/overdue-run '{}' | sed 's#127.0.0.1:3211#localhost:5678#')"
```

## Environment variables

| Name | Where | What |
|---|---|---|
| `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | Written by `npx convex dev` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `.env.local` | Clerk API keys |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex env | Issuer of the Clerk `convex` JWT template |
| `ADMIN_EMAILS` | Convex env | Comma-separated emails that become admin when they sign in with a verified address |
| `N8N_WEBHOOK_URL` | Convex env | WF1 webhook |
| `N8N_HMAC_SECRET` | Convex env and `.env.n8n` | Shared secret that signs requests in both directions |
| `CONVEX_SITE_URL` | `.env.n8n` | Convex HTTP actions as seen from the n8n container |
| `ADMIN_ALERT_EMAIL` | `.env.n8n` | Receives WF3 alerts |
| `MAIL_FROM` | `.env.n8n` | From address of every email |

Convex env values are set with `npx convex env set` and never live in a file in the repo.

## Architecture

Convex holds all data and all rules. Next.js renders pages and calls Convex. n8n holds no state and only sends email. Convex pushes loan events to n8n, and n8n pulls overdue loans from Convex on a schedule.

| Workflow | Starts on | Does |
|---|---|---|
| WF1 Request Notification | Signed `POST /webhook/loan-notification` from Convex | Emails the lender about a new request and the borrower about every decision. Answers 401 to a bad signature and 502 with the reason when the email fails. |
| WF2 Overdue Reminders | Every day at 09:00 UTC, or a signed `POST /webhook/overdue-run` | Asks Convex for overdue loans with `GET /overdue-loans`, emails each borrower, and reports each result with `POST /reminder-status`. Sends at most one reminder per loan per day. |
| WF3 Error Handler | Any failed WF1 or WF2 execution | Emails `ADMIN_ALERT_EMAIL` and records a `workflow_error` row in Convex. |

[docs/architecture.md](docs/architecture.md) has the diagrams, the loan lifecycle, each flow step by step, the failure table and the trade-offs behind each choice.

## Security and data minimization

- **Access control is enforced in Convex.** Every query and mutation checks the caller and loads the row to check ownership. The UI only hides buttons. Admin is granted on the server, only to a verified email listed in `ADMIN_EMAILS`.
- **Both directions are signed.** Convex and n8n sign `timestamp\nMETHOD\npath\nbody` with HMAC-SHA256, compare in constant time and reject timestamps more than 300 seconds off. A changed body or an old request is rejected, and a rejected request gets an empty 401.
- **Minimal data crosses to n8n.** Each message carries the recipient's email and name, the tool name, the status and the dates. It never carries the other party's email. The public page shows only the name and category of available tools.
- **No secrets in git.** Secrets live in Convex env, `.env.n8n` and n8n credentials. `npm run n8n:export` strips the owner's name and email from exported workflows, and `npm test` fails if a workflow file contains a secret-looking string, an email address or a filled-in password.
- **Retries are safe.** Every write-back uses an idempotency key in `automationEvents` (`notify:<loanId>:<status>`, `reminder:<loanId>:<date>`, `error:<executionId>`), so a repeated delivery or a second WF2 run in the same day changes nothing.
- **Failures are visible.** n8n retries each email 3 times. A failure is recorded on the loan, and WF3 alerts the admin and writes a row to Convex.

## What I would change for production

- A real email provider behind the same SMTP credential, with SPF and DKIM.
- A managed n8n with its own database, and the HMAC secret in a secret manager. Rotating the secret would need a short window where both the old and the new secret are accepted.
- An alert when `automationEvents` collects `failed` rows, instead of relying on someone reading the admin inbox.
- A cleanup job for old `automationEvents` rows.
- Clerk production keys and a production Convex deployment, with the app on Vercel.

## Changing a workflow

Edit it in the n8n editor, then write it back to git:

```bash
npm run n8n:export
```

## Things that surprised me

- `n8n import:workflow` deactivates every workflow it imports, including ones it did not change. `npm run n8n:setup` publishes every workflow again for that reason.
- After a restart, the first request can still run the previous version of a workflow. A second request runs the new one.
- With SMTP down, WF1 answers only after its three email tries, about 25 seconds. Convex waits up to 30 seconds before recording a timeout. The first version waited 10 seconds and recorded "The signal has been aborted" instead of the real reason.
