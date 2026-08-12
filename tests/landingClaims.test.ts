import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tripwire (MOO-500): the public landing page states a tool count and lists
// real tool names. Both are claims on a public page — if the agent's tool
// surface changes and the page doesn't, this fails instead of shipping a lie.

const landing = readFileSync("src/components/landing/Landing.tsx", "utf8");
const provision = readFileSync("scripts/provision-agent.ts", "utf8");

// Scoped to the TOOLS array on purpose. A built-in like end_call is a
// capability, not an entry in the tool registry: it never hits /api/tools, it
// has no health dot and no toggle on the control page. Counting it would make
// a public page overstate the registry by one.
function realToolNames(): string[] {
  const TOOLS = provision.split("export const TOOLS")[1]?.split("\n];")[0] ?? "";
  assert.ok(TOOLS, "the TOOLS array is missing from provision-agent.ts");
  const matches = TOOLS.matchAll(/name: ["']([a-z_]+)["']/g);
  return [...new Set([...matches].map((m) => m[1]))].sort();
}

test("landing TOOL_COUNT matches the tools the agent is actually provisioned with", () => {
  const claimed = landing.match(/const TOOL_COUNT = (\d+)/);
  assert.ok(claimed, "Landing.tsx must declare TOOL_COUNT");
  assert.equal(
    Number(claimed[1]),
    realToolNames().length,
    "TOOL_COUNT drifted from scripts/provision-agent.ts"
  );
});

test("every tool the landing page names really exists", () => {
  const real = new Set(realToolNames());
  const listed = [...landing.matchAll(/\["([a-z_]+)", "[a-z]+"\]/g)].map(
    (m) => m[1]
  );
  assert.ok(listed.length > 0, "registry list should not be empty");
  for (const name of listed) {
    assert.ok(real.has(name), `landing lists unknown tool "${name}"`);
  }
});

test("the landing page never claims Zola can send email", () => {
  // The draft-not-send guardrail is the page's central trust claim; keep the
  // copy from quietly contradicting it.
  assert.doesNotMatch(
    landing,
    /\b(I|Zola) (can |will )?sends? (the |your )?(email|mail)\b/i,
    "landing copy must not claim Zola sends email"
  );
});
