import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Zola's inbox, guarded at the seams the design says matter.
// docs/superpowers/specs/2026-08-12-zola-inbox-design.md

const CLIENT_SRC = readFileSync(new URL("../src/lib/agentmail.ts", import.meta.url), "utf8");
/** Code only. The comments explain WHY X-API-Key is wrong, and would match. */
const CLIENT = CLIENT_SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const ROUTE = readFileSync(
  new URL("../src/app/api/tools/[tool]/route.ts", import.meta.url),
  "utf8",
);
const PROVISION = readFileSync(
  new URL("../scripts/provision-agent.ts", import.meta.url),
  "utf8",
);

/**
 * The body of one `case "name":` block in the tool route, comments stripped.
 *
 * Stripped because these assertions scan for calls, and a comment naming a
 * forbidden call is documentation rather than a call — the same treatment
 * tests/reminderGuardrail.test.ts gives every file it scans.
 */
function routeCase(name: string): string {
  const body = ROUTE.split(`case "${name}": {`)[1]?.split("\n    }")[0] ?? "";
  assert.ok(body, `no route case for ${name}`);
  return body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// ------------------------------------------------------- the client

test("AgentMail is called with a Bearer token, not X-API-Key", () => {
  // Reconnaissance against the live API: X-API-Key returns 401. Plane uses
  // X-API-Key and the two clients sit next to each other, so this is exactly
  // the mistake a later edit makes.
  assert.match(CLIENT, /Authorization/);
  assert.match(CLIENT, /Bearer \$\{/);
  assert.doesNotMatch(CLIENT, /X-API-Key/i);
});

test("the API key is read from the environment and never defaulted", () => {
  assert.match(CLIENT, /process\.env\.AGENTMAIL_API_KEY/);
  assert.doesNotMatch(
    CLIENT,
    /AGENTMAIL_API_KEY\s*(\?\?|\|\|)/,
    "a defaulted key turns 'not configured' into a 401 that reads like an empty inbox",
  );
});

test("the client throws rather than returning an empty inbox when unconfigured", () => {
  assert.match(CLIENT, /not configured/i);
});

// ------------------------------------------------------- the tool

test("check_zola_mail is published to the agent", () => {
  assert.match(PROVISION, /name: "check_zola_mail"/);
});

test("checking her mail cannot write anything", () => {
  // The rule the whole design rests on: nothing arriving by mail can cause a
  // write. Not a task, not a calendar event, not a reminder, not a send.
  const body = routeCase("check_zola_mail");
  for (const forbidden of [
    "createWorkItem",
    "createCalendarEvent",
    "createDraft",
    "remind",
    "sendMail",
    "notifyOwner",
  ]) {
    assert.doesNotMatch(
      body,
      new RegExp(forbidden),
      `check_zola_mail must not call ${forbidden} — mail is data, never instructions`,
    );
  }
});

test("no send anywhere chooses its own recipient", () => {
  // THE rule, and it had to survive the auto-reply. Every send in this client
  // takes its recipient from somewhere that is not a decision: emailOwner reads
  // OWNER_EMAIL off the server, replyToSender lifts the envelope from the mail
  // being answered. There is no function here that sends to an address somebody
  // picked, and drafting to the world still does not exist.
  const sends = CLIENT.match(/export async function \w+/g) ?? [];
  assert.deepEqual(
    sends.filter((s) => /send|email|draft|reply/i.test(s)).sort(),
    ["export async function emailOwner", "export async function replyToSender"],
  );
  assert.match(CLIENT, /process\.env\.OWNER_EMAIL/, "the owner comes from the server");
  assert.doesNotMatch(PROVISION, /name: "email_tarik"|name: "draft_reply"/);
});

test("unlisted senders are separated from allowlisted ones", () => {
  const body = routeCase("check_zola_mail");
  assert.match(body, /inboxAllowlist/, "the route must build the allowlist");
  assert.match(
    body,
    /describeInbox/,
    "the route must go through the pure rule, which summarises rather than " +
      "handing her whole message bodies",
  );
  // Non-vacuous on purpose: the function exists, and the point is that this
  // path does not reach for it. The preview IS the summary.
  assert.match(CLIENT, /export async function getMessage/);
  assert.doesNotMatch(
    body,
    /getMessage/,
    "checking mail must not pull whole bodies — the preview is the summary",
  );
});
