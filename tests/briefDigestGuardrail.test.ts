import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// send_brief_digest is a delivery mechanism, not a capability Zola has.
//
// It sends to the owner chat with no destination parameter, and it fires from
// the cron that builds the brief. Nothing about it needs a model's judgement,
// so it must not appear in the agent's tool list or the text channel's — an
// exposed digest tool is a way to make Zola text arbitrary text on request,
// which is exactly what send_telegram already does under its own guardrails.
//
// Every scan here strips comments first. A previous guardrail in this repo
// passed for three rounds because it matched the word it was looking for
// inside the comment explaining the guard.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const RUNNER = CODE("convex/workflowRunner.ts");
const ROUTE = CODE("src/app/api/tools/[tool]/route.ts");

test("Zola is not given the digest tool on the voice channel", () => {
  assert.ok(
    !/send_brief_digest/.test(CODE("scripts/provision-agent.ts")),
    "send_brief_digest must not be provisioned as an agent tool",
  );
});

test("Zola is not given the digest tool on the text channel", () => {
  assert.ok(
    !/send_brief_digest/.test(CODE("src/lib/textTools.ts")),
    "send_brief_digest must not be in the Telegram tool list",
  );
});

test("the route arm exists and sends only through the owner-only door", () => {
  const arm = ROUTE.split('case "send_brief_digest"')[1]?.split("default:")[0];
  assert.ok(arm, "send_brief_digest arm is missing from the tool route");
  assert.match(arm, /notifyOwner\(/, "must send via notifyOwner");
  // notifyOwner takes text and nothing else; a chat id reaching this arm from
  // a request body would be the one way to redirect a brief to someone else.
  assert.ok(
    !/chat_?id/i.test(arm),
    "no chat id may be read at the call site — the destination is server-side",
  );
});

test("a brief whose sections all failed is not sent", () => {
  const arm = ROUTE.split('case "send_brief_digest"')[1]?.split("default:")[0];
  // briefDigest returns "" in that case; the arm must act on it rather than
  // hand an empty string to Telegram.
  assert.match(
    arm,
    /if\s*\(\s*!text\s*\)/,
    "the empty-digest result must short-circuit before notifyOwner",
  );
  assert.ok(
    arm.indexOf("if (!text)") < arm.indexOf("notifyOwner("),
    "the empty check must come before the send, not after",
  );
});

test("only cron-built briefs are texted, and never the consolidation run", () => {
  const set = RUNNER.match(/DIGEST_WORKFLOWS\s*=\s*new Set\(\[([^\]]*)\]\)/)?.[1];
  assert.ok(set, "DIGEST_WORKFLOWS must be a literal set, readable at a glance");
  assert.match(set, /"morning-brief"/);
  assert.ok(
    !/memory-consolidation/.test(set),
    "memory consolidation is not a brief anyone reads",
  );
});

test("the digest only fires on a brief that actually built", () => {
  const call = RUNNER.split("send_brief_digest")[0];
  const guard = call.slice(-400);
  assert.match(
    guard,
    /if\s*\(\s*ready\s*&&\s*DIGEST_WORKFLOWS\.has\(name\)\s*\)/,
    "both the ready check and the workflow allowlist must gate the send",
  );
});

test("a Telegram failure cannot fail the brief run", () => {
  // Bound the slice on the end of this action, not on a character count — the
  // next export (runNow) legitimately throws on a missing Clerk session, and a
  // loose slice reads that as this guard passing.
  const after = RUNNER.split("send_brief_digest")[1]?.split("export const")[0];
  assert.ok(after, "nothing follows the digest call — slice anchor is wrong");
  assert.ok(after.includes("digest.ok"), "slice must cover the result handling");
  assert.ok(
    !/throw\b/.test(after),
    "a failed digest must not throw — the brief itself already succeeded",
  );
});

test("the runner sends the sections it built, not a re-read of the brief", () => {
  // Tool routes are secret-gated and cannot reach a Clerk-authenticated brief
  // query, so a re-read would silently send nothing.
  assert.match(RUNNER, /sections:\s*built/);
});
