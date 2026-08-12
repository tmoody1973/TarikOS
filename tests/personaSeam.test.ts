import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The seam between the two halves of the standing prompt.
//
// A tool's `description` cannot outlive its tool: delete the tool and the
// description goes with it. A persona paragraph can. Delete a tool and its
// paragraph sits there forever, describing a capability that no longer exists,
// and nothing catches it. This test is the thing that catches it.
//
// It mirrors tests/textTools.test.ts, which guards the other list-vs-list seam.

const PROVISION = readFileSync(
  new URL("../scripts/provision-agent.ts", import.meta.url),
  "utf8",
);

const PERSONA = PROVISION.split("export const PERSONA =")[1]?.split("`;")[0] ?? "";
const PUBLISHED = [...PROVISION.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]);

// Argument names are snake_case too, and the persona is allowed to name them.
// They are not tools, so they are not part of this seam.
const ARGUMENTS = new Set([
  ...[...PROVISION.matchAll(/([a-z0-9_]+): (?:bodyProp|boolProp)\(/g)].map((m) => m[1]),
  "standing_context", // the ElevenLabs dynamic variable, not a tool
]);

/** Every snake_case token in a persona that is neither an argument nor a tool. */
function unknownTools(persona: string, published: string[]): string[] {
  const named = new Set(persona.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);
  return [...named].filter((n) => !ARGUMENTS.has(n) && !published.includes(n)).sort();
}

test("the persona and the published tool list were actually found", () => {
  // If either extraction breaks, every assertion below passes vacuously.
  assert.ok(PERSONA.length > 1000, `persona is only ${PERSONA.length} chars`);
  assert.ok(PUBLISHED.length > 20, `only found ${PUBLISHED.length} tools`);
});

test("every tool the persona names is a tool the agent really has", () => {
  assert.deepEqual(
    unknownTools(PERSONA, PUBLISHED),
    [],
    "the persona names something that is not in TOOLS — a tool was renamed or " +
      "deleted and its paragraph outlived it",
  );
});

test("the seam bites when a tool is deleted out from under the persona", () => {
  // The mutation the test exists to catch: a paragraph left behind.
  const orphaned = `${PERSONA}\n- summon_helicopter: does not exist.`;
  assert.deepEqual(unknownTools(orphaned, PUBLISHED), ["summon_helicopter"]);
});

test("the standing context is the last thing in the persona", () => {
  // It changes overnight; everything before it is stable. Under any prefix
  // cache, a memory written last night must not invalidate the tool roster.
  const tail = PERSONA.slice(-400);
  assert.match(tail, /\{\{standing_context\}\}/, "{{standing_context}} must sit at the end");
});

test("the invariants are hoisted to the opening", () => {
  // "Lost in the Middle" (Liu et al., 2023): a model attends most reliably to
  // the start and end of a long context. These two are absolute, so they go
  // where they will be read.
  const opening = PERSONA.slice(0, 1600);
  assert.match(opening, /never send|NEVER send/i, "the no-send rule must open the persona");
  assert.match(
    opening,
    /never (pick|choose)/i,
    "the never-pick-between-matches rule must open the persona",
  );
});
