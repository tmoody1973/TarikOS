import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Zola can place real phone calls. The guardrail is structural rather than
// behavioural: `call_tarik` has no destination parameter, so there is no code
// path that dials anything except OWNER_PHONE. A prompt can be argued with; a
// missing parameter cannot. These scan the source the way the mail no-send and
// habits no-streak tripwires do.

const route = readFileSync(
  new URL("../src/app/api/tools/[tool]/route.ts", import.meta.url),
  "utf8",
);
const provision = readFileSync(
  new URL("../scripts/provision-agent.ts", import.meta.url),
  "utf8",
);

/** The body of the call_tarik case, from its `case` label to the next one. */
function callCase(): string {
  const start = route.indexOf('case "call_tarik"');
  assert.ok(start > -1, "call_tarik case must exist in the tool route");
  const next = route.indexOf("\n    case ", start + 1);
  return route.slice(start, next > -1 ? next : route.length);
}

test("call_tarik dials OWNER_PHONE and nothing else", () => {
  const fn = callCase();
  assert.match(
    fn,
    /process\.env\.OWNER_PHONE/,
    "the destination must come from OWNER_PHONE",
  );
});

test("call_tarik never reads a destination out of the request body", () => {
  const fn = callCase();
  // `body` may be read for a reason string, but never for anything
  // number-shaped — that is the only way a caller could redirect the dial.
  const numberish =
    /body\.(?:\w*(?:number|phone|to|dial|recipient|destination|target)\w*)/i;
  assert.ok(
    !numberish.test(fn),
    "call_tarik must not take its destination from the request body",
  );
  assert.ok(
    !/to_number["']?\s*:\s*(?!.*OWNER_PHONE)[^,\n]*body/.test(fn),
    "to_number must never be derived from the request body",
  );
});

test("the published call_tarik schema exposes no destination field", () => {
  const start = provision.indexOf('name: "call_tarik"');
  assert.ok(start > -1, "call_tarik must be registered in TOOLS");
  const end = provision.indexOf('type: "webhook"', start);
  const entry = provision.slice(start, end > -1 ? end : start + 2000);
  const properties = entry.slice(entry.indexOf("properties:"));
  // Match a property KEY, however it is declared — `bodyProp(...)` here, not
  // an object literal. The first version of this test looked for `number: {`
  // and was structurally incapable of firing.
  const offersADestination =
    /^\s*\w*(?:number|phone|recipient|destination|dial|target|callee)\w*\s*:/im;
  assert.ok(
    !offersADestination.test(properties),
    "the agent-facing schema must not offer a number to dial",
  );
});

test("no other tool route gains an unguarded outbound-call path", () => {
  // If a second dialling site appears, it must be reviewed on purpose rather
  // than inherited by copy-paste. Update this test deliberately.
  const sites = route.match(/sip-trunk\/outbound-call/g) ?? [];
  assert.equal(
    sites.length,
    1,
    `expected exactly one outbound-call site, found ${sites.length}`,
  );
});
