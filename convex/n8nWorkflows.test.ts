import { describe, expect, test } from "vitest";

// Static checks on the exported n8n workflows: n8n itself never runs in `npm test`,
// so this is what stops a secret, personal data or a missing retry from reaching git.

type Node = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  retryOnFail?: boolean;
  maxTries?: number;
};
type Workflow = { id: string; name: string; nodes: Node[]; settings: { errorWorkflow?: string } };

const ALLOWED_KEYS = ["connections", "id", "name", "nodes", "settings"];
const RETRIED_TYPES = ["n8n-nodes-base.emailSend", "n8n-nodes-base.httpRequest"];
// Same message convex/lib/hmac.ts signs: timestamp, method, path and body, newline-separated.
const SIGNED_MESSAGE = /`\$\{ts\}\\n(GET|POST|\$\{\w+\})\\n\$\{\w+\}\\n\$\{\w+\}`/;

const files = Object.entries(
  import.meta.glob<Workflow>("../n8n/workflows/*.json", { eager: true, import: "default" }),
);
const workflows = files.map(([, workflow]) => workflow);
const errorHandler = workflows.find((w) => w.nodes.some((n) => n.type === "n8n-nodes-base.errorTrigger"));

function stringValues(value: unknown, key = ""): Array<[string, string]> {
  if (typeof value === "string") return [[key, value]];
  if (Array.isArray(value)) return value.flatMap((item) => stringValues(item, key));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => stringValues(v, k));
  return [];
}

test("there is at least one exported workflow", () => {
  expect(files.length).toBeGreaterThan(0);
});

describe.each(files)("%s", (_file, workflow) => {
  test("keeps only the allow-listed top-level fields", () => {
    expect(Object.keys(workflow).sort()).toEqual(ALLOWED_KEYS);
  });

  test("contains no secret or email address", () => {
    for (const [key, value] of stringValues(workflow)) {
      expect(/^(password|apiKey|secret|token)$/i.test(key) && value !== "", `non-empty ${key}`).toBe(false);
      expect(value, `64-hex value under ${key}`).not.toMatch(/\b[0-9a-f]{64}\b/i);
      expect(value, `literal email under ${key}`).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    }
  });

  test("retries every email and HTTP node", () => {
    for (const node of workflow.nodes.filter((n) => RETRIED_TYPES.includes(n.type))) {
      expect(node.retryOnFail, node.name).toBe(true);
      expect(node.maxTries ?? 0, node.name).toBeGreaterThanOrEqual(3);
    }
  });

  test("signs and verifies with the same message format as Convex", () => {
    for (const node of workflow.nodes.filter((n) => String(n.parameters.jsCode ?? "").includes("createHmac"))) {
      expect(node.parameters.jsCode, node.name).toMatch(SIGNED_MESSAGE);
    }
  });

  test.skipIf(!errorHandler || workflow === errorHandler)("reports its failures to the error handler", () => {
    expect(workflow.settings.errorWorkflow).toBe(errorHandler?.id);
  });
});
