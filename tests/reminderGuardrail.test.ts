import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reminders reach Tarik by email, which brushes against the oldest guardrail in
// this system: "Zola drafts; only a human sends."
//
// The distinction these tests defend: that rule governs CORRESPONDENCE, mail
// sent to other people as him. A reminder is a notification to himself, built
// in the shape call_tarik established — the recipient is not a parameter of
// anything, it comes from the server, and it never touches Gmail.
//
// Comments are stripped before every scan.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const ROUTE = CODE("src/app/api/tools/[tool]/route.ts");
const RESEND = CODE("src/lib/resend.ts");
const DB = CODE("convex/remindersDb.ts");
const PROVISION = readFileSync("scripts/provision-agent.ts", "utf8");

const routeCase = (name: string) =>
  ROUTE.split(`case "${name}":`)[1]?.split("\n    case ")[0] ?? "";

// --------------------------------------------- the no-send rule survives

test("the tool route still has no Gmail send path", () => {
  // The original guardrail, restated here because this is the change most
  // likely to erode it.
  assert.doesNotMatch(ROUTE, /sendDraft|SEND_DRAFT|GMAIL_SEND/);
});

test("the reminder email recipient is not a parameter of anything", () => {
  // THE rule that makes an email channel safe. Same shape as call_tarik: there
  // is no argument to pass, so there is nothing to talk her into.
  assert.match(RESEND, /process\.env\.OWNER_EMAIL/);
  const fn = RESEND.split("export async function emailOwner")[1] ?? "";
  assert.ok(fn, "emailOwner is missing");
  assert.doesNotMatch(
    fn,
    /\bto\s*[:=]\s*(?!\[to\])(?!to\b)[a-z]*(?:recipient|address|email)/i,
    "the recipient must come from the environment, never an argument",
  );
  // And its signature takes a subject and a body. Nothing else.
  const sig = RESEND.split("export async function emailOwner")[1]?.split(")")[0] ?? "";
  assert.doesNotMatch(sig, /to|recipient|address/i, "emailOwner must not accept a recipient");
});

test("the published reminder tool offers no recipient field", () => {
  const start = PROVISION.indexOf('name: "remind_me"');
  assert.ok(start > -1, "remind_me must be published");
  const entry = PROVISION.slice(start, PROVISION.indexOf('type: "webhook"', start + 1));
  const properties = entry.slice(entry.indexOf("properties:"));
  assert.doesNotMatch(
    properties,
    /^\s*\w*(?:to|recipient|address|email_to|number|phone)\w*\s*:/im,
    "the agent-facing schema must not offer somewhere to send it",
  );
});

test("delivery is not a tool Zola can call", () => {
  // deliver_reminder exists for the Convex scheduler, like send_brief_digest.
  // Nothing about delivering a reminder needs a model's judgement, and a tool
  // she can call is a tool she can call at the wrong moment.
  assert.ok(routeCase("deliver_reminder"), "the delivery route must exist");
  assert.doesNotMatch(PROVISION, /name: "deliver_reminder"/);
});

test("delivery is secret-gated like every other tool route", () => {
  // It shares the route's single secret check; assert the route still has one
  // rather than trusting that by memory.
  assert.match(ROUTE, /x-morpheus-secret|checkToolSecret|MORPHEUS_TOOL_SECRET/);
});

// ------------------------------------------------- reminders behave

test("a missing Resend key is reported, not swallowed", () => {
  // An unconfigured channel that reports success is a reminder he never gets
  // and never learns he never got.
  assert.match(RESEND, /RESEND_API_KEY is not set/);
  assert.match(RESEND, /OWNER_EMAIL is not set/);
});

test("scheduling writes the row before it schedules the fire", () => {
  // The other order can leave a timer with nothing behind it: invisible in any
  // list and impossible to cancel.
  const fn = DB.split("export const schedule =")[1]?.split("\nexport const ")[0] ?? "";
  assert.ok(fn, "schedule is missing");
  const insert = fn.indexOf("db.insert");
  const sched = fn.indexOf("scheduler.runAt");
  assert.ok(insert >= 0 && sched >= 0, "both the insert and the schedule must exist");
  assert.ok(insert < sched, "the row must exist before the fire is scheduled");
});

test("cancelling sets a status rather than trying to unschedule", () => {
  // The fire still runs and finds a row that is no longer pending. That has no
  // race; cancelling a timer that may already be executing does.
  const fn = DB.split("export const cancel =")[1]?.split("\nexport const ")[0] ?? "";
  assert.match(fn, /"cancelled"/);
  assert.doesNotMatch(fn, /cancelJob|scheduler\.cancel/);
});

test("the fire refuses anything no longer pending", () => {
  const claim = DB.split("export const claim =")[1]?.split("\nexport const ")[0] ?? "";
  assert.match(claim, /status !== "pending"/, "claim must check the status");
  assert.match(claim, /return null/, "a non-pending reminder must yield nothing to send");
});

test("a failed delivery is recorded with its reason", () => {
  const fire = CODE("convex/reminders.ts");
  assert.match(fire, /status: "failed"/);
  assert.match(fire, /error/);
});

test("cancelling by voice reads back both when two match", () => {
  const body = routeCase("cancel_reminder");
  const ambiguous = body.split("matches.length > 1")[1]?.split("\n      }")[0] ?? "";
  assert.ok(ambiguous.includes("Which one?"), "two matches must end in a question");
  assert.doesNotMatch(ambiguous, /remindersDb\.cancel/, "an ambiguous quote must cancel nothing");
});
