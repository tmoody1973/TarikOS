import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOL_OUTCOMES } from "../src/lib/toolOutcome.ts";

// `outcome` is telemetry. If it ever reaches the wire, the agent sees a field
// shaped like an instruction next to the message it speaks from — and the
// whole point of keeping it separate from `ok` is that Zola's behaviour does
// not change. These scan the source the way the mail no-send and browser
// no-credentials tripwires do.

const route = readFileSync(
  new URL("../src/app/api/tools/[tool]/route.ts", import.meta.url),
  "utf8",
);

test("the tool result is stripped of outcome before it is serialized", () => {
  assert.match(route, /const \{ outcome: _outcome, \.\.\.wire \} = result/);
  assert.match(route, /NextResponse\.json\(wire,/);
  // The un-stripped result must not be handed to the response.
  assert.ok(
    !/NextResponse\.json\(result,/.test(route),
    "serializing `result` directly would leak outcome to the agent",
  );
});

test("every tool call is wrapped in a span, including cron-initiated ones", () => {
  assert.match(route, /getTracer\(\)\.startSpan\(`tool\.\$\{tool\}`\)/);
  assert.match(route, /"openinference\.span\.kind": "TOOL"/);
});

test("a tool disabled in the control panel is recorded as disabled, not an error", () => {
  // classifyOutcome would otherwise read ok:false and call it "error", which
  // would make a deliberate kill-switch flip indistinguishable from a fault.
  assert.match(route, /"tool\.outcome": "disabled"/);
});

test("outcome values used in the route are all real ToolOutcomes", () => {
  const used = new Set(
    [...route.matchAll(/outcome: "([a-z_]+)"/g)].map((m) => m[1]),
  );
  assert.ok(used.size > 0, "the non-result sites must be tagged");
  for (const value of used) {
    assert.ok(
      (TOOL_OUTCOMES as readonly string[]).includes(value),
      `"${value}" is not a ToolOutcome`,
    );
  }
});
