import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_INBOX_QUERY, buildInboxQuery } from "../convex/mailFilterLib.ts";

// Muting the robots (inbox noise).
//
// The inbox panel asks Gmail for six messages. Four of Tarik's were automated
// pipeline reports — "OK Q1-HOURLY: 84 rows", "OK FUNRAISE: 1 rows" — so the
// panel was almost entirely machine chatter and the real mail never made the
// cut. Filtering has to happen in the GMAIL QUERY, not after: excluded there,
// the noise never costs one of the six slots, never reaches the brief, and
// never reaches Zola.

const none = { senders: [], subjects: [] };

test("no mutes leaves the query exactly as it was", () => {
  // The base query is what shipped for months. Muting nothing must not change
  // which mail arrives.
  assert.equal(buildInboxQuery(none), BASE_INBOX_QUERY);
});

test("a muted sender becomes a negated from: term", () => {
  const q = buildInboxQuery({ senders: ["noreply@tritondigital.com"], subjects: [] });
  assert.ok(q.startsWith(BASE_INBOX_QUERY), "the base query must be preserved");
  assert.match(q, /-from:noreply@tritondigital\.com/);
});

test("a muted subject is quoted, because Gmail splits on spaces", () => {
  // Unquoted, `-subject:OK Q1-HOURLY` excludes anything containing "OK" and
  // separately searches for "Q1-HOURLY" — which would hide most of the inbox.
  const q = buildInboxQuery({ senders: [], subjects: ["OK Q1-HOURLY"] });
  assert.match(q, /-subject:"OK Q1-HOURLY"/);
});

test("a single-word subject is quoted too, so one rule reads the same everywhere", () => {
  const q = buildInboxQuery({ senders: [], subjects: ["FUNRAISE"] });
  assert.match(q, /-subject:"FUNRAISE"/);
});

test("blank and whitespace-only entries are dropped", () => {
  // The control panel is a text field. Empty lines are inevitable, and
  // `-from:` with nothing after it is a malformed query Gmail rejects.
  const q = buildInboxQuery({ senders: ["", "   "], subjects: ["\t"] });
  assert.equal(q, BASE_INBOX_QUERY);
});

test("duplicates are collapsed, ignoring case", () => {
  // Gmail matching is case-insensitive, so two spellings are one rule and
  // sending both just wastes query length.
  const q = buildInboxQuery({
    senders: ["Noreply@Triton.com", "noreply@triton.com"],
    subjects: [],
  });
  assert.equal(q.match(/-from:/g)?.length, 1);
});

test("a quote inside a subject cannot break out of its own term", () => {
  // `-subject:"say "hi""` truncates the term and turns the rest into stray
  // search words — the query equivalent of an injection.
  // Asserted exactly. The first version used /-subject:"say .hi. now"/ — and
  // `.` matches a double quote, the precise character under test, so the
  // unescaped output passed its own guard.
  const q = buildInboxQuery({ senders: [], subjects: ['say "hi" now'] });
  assert.equal(q, `${BASE_INBOX_QUERY} -subject:"say 'hi' now"`);
  assert.equal(q.split('"').length - 1, 2, "a term must open and close exactly once");
});

test("the query cannot grow without bound", () => {
  // Gmail rejects very long queries, and a rejected query means NO mail at
  // all — a mute list that silently empties the inbox is worse than the noise.
  const many = Array.from({ length: 400 }, (_, i) => `sender${i}@example.com`);
  const q = buildInboxQuery({ senders: many, subjects: [] });
  assert.ok(q.length < 2000, `query too long: ${q.length}`);
  assert.ok(q.startsWith(BASE_INBOX_QUERY), "truncation must keep the base query");
});

test("what gets dropped by the cap is reported, not silently lost", () => {
  // Otherwise a rule someone added does nothing and there is no way to tell.
  const many = Array.from({ length: 400 }, (_, i) => `sender${i}@example.com`);
  const { dropped } = buildInboxQuery({ senders: many, subjects: [] }, { detail: true });
  assert.ok(dropped > 0, "a truncated list must report how many rules were dropped");
});

test("senders and subjects both survive when mixed", () => {
  // The copy-paste failure: one loop written, the other forgotten.
  const q = buildInboxQuery({
    senders: ["robot@example.com"],
    subjects: ["OK FUNRAISE"],
  });
  assert.match(q, /-from:robot@example\.com/);
  assert.match(q, /-subject:"OK FUNRAISE"/);
});

test("a malformed mute list does not take the inbox down", () => {
  // This comes out of a database and is edited in a free-text field.
  const q = buildInboxQuery({ senders: undefined, subjects: null } as never);
  assert.equal(q, BASE_INBOX_QUERY);
});

// Wiring: the mute list has to reach every surface, or the robots are hidden
// from one screen and still read out on another.

import { readFileSync } from "node:fs";

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

test("the panel and the voice path share one mute list", () => {
  // Two lists would let the dashboard hide a sender that Zola still reads
  // aloud — the same disagreement two brief stores would have caused.
  const panel = CODE("src/app/api/panels/inbox/route.ts");
  const tools = CODE("src/app/api/tools/[tool]/route.ts");
  assert.match(panel, /mailFilters\.forTools/);
  assert.match(tools, /mailFilters\.forTools/);
});

test("both callers actually pass the list to the fetch", () => {
  // Reading the setting and then calling getRecentEmails() with no argument
  // is the failure this catches: everything looks wired and nothing is muted.
  const panel = CODE("src/app/api/panels/inbox/route.ts");
  const tools = CODE("src/app/api/tools/[tool]/route.ts");
  assert.match(panel, /getRecentEmails\(mutes/);
  assert.match(tools, /getRecentEmails\(mutes\)/);
});

test("the query is built once, where the base query lives", () => {
  // A second hand-written "in:inbox category:primary" anywhere would drift.
  const google = CODE("src/lib/google.ts");
  assert.match(google, /buildInboxQuery\(/);
  assert.ok(
    !/in:inbox category:primary/.test(google),
    "the base query must come from mailFilterLib, not be repeated here",
  );
});
