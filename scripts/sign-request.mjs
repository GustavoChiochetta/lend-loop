#!/usr/bin/env node
// Prints a signed curl command for the Convex HTTP actions, signed by the same
// helper Convex uses. Run through `npm run -s sign -- <METHOD> </path> [body]`.
import { signedHeaders } from "../convex/lib/hmac.ts";

const [method = "", path = "", body = ""] = process.argv.slice(2);
const secret = process.env.N8N_HMAC_SECRET;
if (!method || !path.startsWith("/") || !secret) {
  console.error("usage: npm run -s sign -- <METHOD> </path> [body]   (reads N8N_HMAC_SECRET from .env.n8n)");
  process.exit(1);
}

const base = process.env.CONVEX_SITE_URL?.replace("host.docker.internal", "127.0.0.1") ?? "http://127.0.0.1:3211";
const quote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
const headers = Object.entries(await signedHeaders(secret, method.toUpperCase(), path, body));

console.log(
  [
    "curl -sS -i",
    `-X ${method.toUpperCase()}`,
    ...headers.map(([name, value]) => `-H ${quote(`${name}: ${value}`)}`),
    ...(body ? [`-H 'Content-Type: application/json'`, `--data-raw ${quote(body)}`] : []),
    quote(`${base}${path}`),
  ].join(" "),
);
