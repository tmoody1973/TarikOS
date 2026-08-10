import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The SMS number is public: anyone who learns it can text it, and there is no
// secret in the address the way there is in /f/<slug>. Two things therefore
// carry the whole inbound boundary, and both are pinned here.
//
//   The Ed25519 signature — proves Telnyx sent it.
//   The allowlist — proves Tarik sent it.
//
// Same species as callGuardrails and documentShareGuardrail.

const route = readFileSync(
  new URL("../src/app/api/sms/inbound/route.ts", import.meta.url),
  "utf8",
);
const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");

/** The route with comments removed — prose explains the guards and would
 * otherwise satisfy assertions about them. This has now bitten twice. */
const code = route.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("/api/sms is exempt from Clerk, deliberately", () => {
  assert.match(proxy, /"\/api\/sms\(\.\*\)"/);
});

/** The handler only. Searching the whole file found the *import* of
 * isAllowedSender, which naturally precedes everything, and reported the
 * ordering backwards. */
const handler = code.slice(code.indexOf("export async function POST"));

test("the signature is verified before anything is trusted", () => {
  const verify = handler.indexOf("webhooks.unwrap");
  const allowlist = handler.indexOf("isAllowedSender");
  assert.ok(verify > -1, "the route must verify the Telnyx signature");
  assert.ok(allowlist > -1, "the route must check the allowlist");
  assert.ok(
    verify < allowlist,
    "verification comes first — an unsigned body's `from` is whatever the " +
      "caller typed, so checking the allowlist against it proves nothing",
  );
});

test("a bad signature is refused, not merely noted", () => {
  const failure = code.slice(code.indexOf("catch"), code.indexOf("event.data"));
  assert.match(failure, /status:\s*400/, "a failed signature must not be a 200");
});

test("the raw body is what gets verified", () => {
  // The signature covers exact bytes. Verifying a re-serialized object would
  // pass in testing and fail on any payload whose key order or spacing differs.
  assert.match(code, /req\.text\(\)/);
  assert.ok(
    !/req\.json\(\)/.test(code),
    "parsing before verifying loses the bytes the signature was made over",
  );
});

test("a stranger gets no reply at all", () => {
  // The refusal branch, from the allowlist check to its closing return.
  const gate = handler.indexOf("if (!isAllowedSender");
  assert.ok(gate > -1, "the allowlist must guard, not merely be consulted");
  const branch = handler.slice(gate, handler.indexOf("}", handler.indexOf("status: 200", gate)));
  assert.match(branch, /status:\s*200/, "acknowledged so Telnyx stops retrying");
  assert.ok(
    !/messages\.send|sendLongCode|sendNumberPool/.test(branch),
    "no outbound call may sit on the refusal path — a reply of any kind " +
      "confirms the number is live and costs a segment per probe",
  );
});

test("message contents never reach the log", () => {
  // The values are Tarik's text messages; the deployment log is not where
  // they belong. Only key paths and types are logged.
  const logs = [...code.matchAll(/console\.(log|warn|error)\(([^;]*)\);/g)].map(
    (m) => m[2],
  );
  assert.ok(logs.length > 0, "the capture pass logs something");
  for (const line of logs) {
    assert.ok(
      !/payload\.text|\.text\b|body|raw/.test(line),
      `a log line may not carry message content: ${line.slice(0, 60)}`,
    );
  }
});

test("no reply loop is wired yet, and that is on purpose", () => {
  // 10DLC is unregistered, so outbound would be filtered by US carriers and a
  // reply loop could not be honestly tested. When this test starts failing,
  // the thing to check is that registration actually landed.
  assert.ok(
    !/messages\.send|sendLongCode|sendNumberPool/.test(code),
    "outbound waits for 10DLC registration",
  );
});
