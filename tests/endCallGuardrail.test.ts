import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Zola can hang up.
//
// She could not before: the live agent came back with `end_call: null` and
// every other built-in null too, because ElevenLabs only enables end_call by
// default for agents made in their dashboard, and this one is provisioned from
// scripts/provision-agent.ts.
//
// The interesting risk is not that she fails to end a session. It is that she
// ends one he was still in — "okay" and "sure" are most of how Tarik talks, and
// a session that hangs up on him costs him the whole thread.

const PROVISION = readFileSync("scripts/provision-agent.ts", "utf8");
const DOCK = readFileSync("src/components/VoiceDock.tsx", "utf8");

const endCall = PROVISION.split("const SYSTEM_TOOLS")[1]?.split("\n];")[0] ?? "";

test("the agent is provisioned with the end call tool", () => {
  assert.ok(endCall, "SYSTEM_TOOLS is missing from the provision script");
  assert.match(endCall, /name: "end_call"/);
  assert.match(endCall, /systemToolType: "end_call"/, "the params discriminant is required");
});

test("the end call tool is sent in the tools array, not built_in_tools", () => {
  // THE TRAP, paid for live. The agent config has a `built_in_tools` map and
  // writing end_call into it does nothing at all: the API returns 200, reports
  // success, and leaves the value null. A system tool goes in `tools`; the API
  // then reflects it back into `built_in_tools` on read, which is exactly what
  // makes the wrong shape look right.
  assert.match(
    PROVISION,
    /tools: \[\.\.\.TOOLS, \.\.\.SYSTEM_TOOLS\]/,
    "system tools must be concatenated into the tools array",
  );
  assert.doesNotMatch(
    PROVISION.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""),
    /builtInTools:/,
    "writing to builtInTools is silently ignored — it only ever looks like it worked",
  );
});

test("the end call tool is not in the webhook registry", () => {
  // TOOLS is the list with health dots and toggles, and the number the landing
  // page claims. end_call never reaches /api/tools, so it is not one of them.
  const tools = PROVISION.split("export const TOOLS")[1]?.split("\n];")[0] ?? "";
  assert.doesNotMatch(tools, /name: "end_call"/);
});

test("she is told which words actually close a conversation", () => {
  // The mechanics of one tool live in that tool's description, the same rule
  // the persona reshape applied to the other forty-seven.
  assert.match(endCall, /that's all|goodbye|we're done/i, "name the closing phrases");
});

test("she is told not to hang up on a filler word", () => {
  // "Yes.", "Sure, why not?", "Uh, we can try it." — the eval's labelled
  // utterances are full of these, and none of them mean goodbye.
  assert.match(
    endCall,
    /okay|sure|never end/i,
    "the description must forbid ending on something that merely sounds final",
  );
});

test("the button is still the hard stop", () => {
  // A model deciding when to hang up is a convenience. The control that does
  // not depend on her judgement has to survive it.
  assert.match(DOCK, /endSession\(\)/, "DISENGAGE must still end the session directly");
  assert.match(DOCK, /DISENGAGE/);
});

test("the landing page's tool count counts webhook tools, not built-ins", () => {
  // end_call is a capability, not an entry in the tool registry: it never hits
  // /api/tools, has no health dot and no toggle. Counting it would make a
  // public page overstate the registry by one.
  const claims = readFileSync("tests/landingClaims.test.ts", "utf8");
  assert.match(
    claims,
    /export const TOOLS|TOOLS\b/,
    "the count must be scoped to the TOOLS array rather than every name in the file",
  );
});
