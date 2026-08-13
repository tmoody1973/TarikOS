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
  // THE rule, and it has now survived the auto-reply AND the two tools that let
  // her use these paths herself. Every send in this client takes its recipient
  // from somewhere that is not a decision: emailOwner reads OWNER_EMAIL off the
  // server, replyToSender lifts the envelope from the mail being answered.
  // createReplyDraft is the third, and it does not send at all.
  const sends = CLIENT.match(/export async function \w+/g) ?? [];
  assert.deepEqual(
    sends.filter((s) => /send|email|draft|reply/i.test(s)).sort(),
    [
      "export async function createReplyDraft",
      "export async function emailOwner",
      "export async function replyToSender",
    ],
  );
  assert.match(CLIENT, /process\.env\.OWNER_EMAIL/, "the owner comes from the server");
});

/** The body of one `export async function name` in the client, comments stripped. */
function clientFn(name: string): string {
  const body = CLIENT.split(`export async function ${name}(`)[1]?.split("\n}")[0] ?? "";
  assert.ok(body, `no client function ${name}`);
  return body;
}

test("drafting a reply writes a draft and never sends one", () => {
  // The whole difference between the two halves of the rule. Sending hits
  // /messages/send; drafting hits /drafts and stops there. Confusing the two
  // would turn "she drafts to everyone else" into "she writes to everyone
  // else", silently, with a 200.
  const draft = clientFn("createReplyDraft");
  assert.match(draft, /\/drafts/, "a draft goes to the drafts resource");
  assert.doesNotMatch(
    draft,
    /messages\/send/,
    "createReplyDraft must not reach the send endpoint",
  );
});

test("nothing in this codebase releases a draft", () => {
  // AgentMail has POST /drafts/{id}/send and it really does send. Releasing is
  // Tarik's gesture, made wherever he can see the draft — never something a
  // tool can reach.
  const src = readFileSync("src/lib/agentmail.ts", "utf8");
  assert.doesNotMatch(src, /drafts\/\$\{[^}]*\}\/send|\/drafts\/.*\/send/);
  assert.doesNotMatch(ROUTE, /drafts\/[^"'`\s]*\/send/);
});

// ------------------------------------------------------- writing to him

test("email_tarik is published to the agent", () => {
  assert.match(PROVISION, /name: "email_tarik"/);
});

test("the privileged recipient is not a parameter of email_tarik", () => {
  // The call_tarik shape, now applied to mail: there is no argument to pass and
  // therefore nothing to talk her into. The address comes from the server.
  const body = routeCase("email_tarik");
  assert.match(body, /emailOwner\(/);
  for (const arg of ["body.to", "body.recipient", "body.email", "body.address"]) {
    assert.doesNotMatch(
      body,
      new RegExp(arg.replace(".", "\\.")),
      `email_tarik must not read ${arg} — the recipient comes from OWNER_EMAIL`,
    );
  }
});

// ------------------------------------------------------- drafting to everyone else

test("draft_reply is published to the agent", () => {
  assert.match(PROVISION, /name: "draft_reply"/);
});

test("draft_reply cannot send", () => {
  const body = routeCase("draft_reply");
  for (const forbidden of ["emailOwner", "replyToSender", "sendMail", "createDraft"]) {
    assert.doesNotMatch(
      body,
      new RegExp(forbidden),
      `draft_reply must not call ${forbidden} — it drafts and stops`,
    );
  }
  assert.match(body, /createReplyDraft\(/);
});

test("draft_reply takes its recipient off a message that already arrived", () => {
  const body = routeCase("draft_reply");
  assert.match(body, /pickReplyTarget/, "the target comes from the pure rule");
  for (const arg of ["body.to", "body.recipient", "body.address"]) {
    assert.doesNotMatch(
      body,
      new RegExp(arg.replace(".", "\\.")),
      `draft_reply must not read ${arg} — a chosen recipient is the whole thing being prevented`,
    );
  }
});

test("no tool schema offers her an outbound address to fill in", () => {
  // Read from the published schemas rather than the route, because the schema
  // is what the model actually sees. A field she can fill in is a field she can
  // be talked into filling in.
  for (const tool of ["email_tarik", "draft_reply"]) {
    const schema = PROVISION.split(`name: "${tool}"`)[1]?.split("\n  },")[0] ?? "";
    assert.ok(schema, `no tool definition for ${tool}`);
    assert.doesNotMatch(
      schema,
      /\b(to|recipient|address|cc|bcc)\s*:\s*(bodyProp|boolProp|\{)/,
      `${tool} must not expose a recipient field`,
    );
  }
});

test("the persona carries the one-sentence rule", () => {
  // She writes to him freely, and drafts to everyone else. If the tools exist
  // and the sentence does not, she has two send-shaped tools and no idea which
  // is which.
  assert.match(PROVISION, /email_tarik/);
  assert.match(PROVISION, /draft_reply/);
});

test("a recipient is permitted only after every gate has passed", () => {
  // allowRecipient writes to AgentMail's own outbound allow list. It must sit
  // AFTER the shouldAutoReply decision, never before — permitting first and
  // deciding second would hand the provider's gate away to anyone who wrote in.
  const route = readFileSync("src/app/api/agentmail/inbound/route.ts", "utf8");
  const decided = route.indexOf("if (!decision.ok)");
  const permitted = route.indexOf("await allowRecipient(");
  assert.ok(decided > 0 && permitted > 0, "both steps must exist");
  assert.ok(permitted > decided, "permission must come after the decision, not before");
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
