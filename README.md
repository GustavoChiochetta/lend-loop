This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

Until the Phase 5 workflows exist, a published n8n workflow with a single Webhook node (`POST`, path `loan-notification`) is enough to see each notification under Executions. Every attempt is also recorded in the `automationEvents` table.

Try the Convex endpoints without n8n (Node 22, reads `.env.n8n`):

```bash
eval "$(npm run -s sign -- GET /overdue-loans)"
```
