#!/usr/bin/env node
// Exports every non-archived n8n workflow to n8n/workflows/<name>.json.
// Fields are allow-listed: a raw export also carries the owner's name and email
// (`shared`), version counters and pinned test data, none of which belong in git.
// `id` stays so the error workflow setting still resolves after an import.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const KEEP = ["id", "name", "nodes", "connections", "settings"];
const DIR = "n8n/workflows";
const TMP = "/tmp/lendloop-export.json";

const raw = execFileSync(
  "docker",
  ["compose", "exec", "-T", "n8n", "sh", "-c", `n8n export:workflow --all --output=${TMP} >/dev/null && cat ${TMP}`],
  { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
);

const slug = (name) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

mkdirSync(DIR, { recursive: true });
for (const workflow of JSON.parse(raw)) {
  if (workflow.isArchived) continue;
  const file = `${DIR}/${slug(workflow.name)}.json`;
  const kept = Object.fromEntries(KEEP.map((key) => [key, workflow[key]]));
  writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
  console.log(`exported ${file}`);
}
