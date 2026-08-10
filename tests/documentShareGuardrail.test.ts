import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRMATION_TTL_MS,
  isConfirmationValid,
  newConfirmation,
} from "../convex/documentsLib.ts";

// Sharing is the only action in Tarik OS that puts content behind a URL which
// works with no Clerk session — and the sources are briefs, research, and
// journal digests, which carry mail summaries and personal reflection.
//
// The design assumed a "spoken-confirm ritual" already existed in the tool
// route. It does not: create_calendar_event validates arguments and writes.
// The only confirmation in the system is prompt text asking the agent to say a
// sentence first, and the tool-selection eval measured this model calling a
// tool on 12 of 58 turns where the right answer was to do nothing.
//
// So the gate is structural: no confirmation record, no share link. These
// tests are the tripwire, in the same family as callGuardrails.

const DOC = "doc_abc123";
const OTHER = "doc_zzz999";
const NOW = Date.parse("2026-08-09T18:00:00Z");

test("a fresh confirmation for the right document is valid", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(
    isConfirmationValid(c, { token: c.token, documentId: DOC, now: NOW }),
    true,
  );
});

test("no confirmation record at all is never valid", () => {
  // The default must be denial. A missing record is the shape an attacker —
  // or a model that skipped a step — produces.
  assert.equal(
    isConfirmationValid(undefined, {
      token: "anything",
      documentId: DOC,
      now: NOW,
    }),
    false,
  );
});

test("a token bound to one document cannot share another", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(
    isConfirmationValid(c, { token: c.token, documentId: OTHER, now: NOW }),
    false,
    "confirming one document must not authorize sharing a different one",
  );
});

test("the wrong token is rejected even for the right document", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(
    isConfirmationValid(c, {
      token: newConfirmation(DOC, NOW).token,
      documentId: DOC,
      now: NOW,
    }),
    false,
  );
});

test("a confirmation is single-use", () => {
  const c = newConfirmation(DOC, NOW);
  const used = { ...c, used: true };
  assert.equal(
    isConfirmationValid(used, { token: c.token, documentId: DOC, now: NOW }),
    false,
    "replaying a spent confirmation must not mint a second link",
  );
});

test("a confirmation expires", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(
    isConfirmationValid(c, {
      token: c.token,
      documentId: DOC,
      now: NOW + CONFIRMATION_TTL_MS + 1,
    }),
    false,
  );
});

test("the confirmation window is short — minutes, not hours", () => {
  // A long window means "yes" said once keeps authorizing shares later in the
  // conversation, which is the failure this gate exists to prevent.
  assert.ok(
    CONFIRMATION_TTL_MS <= 10 * 60 * 1000,
    "confirmation TTL must be 10 minutes or less",
  );
});

test("confirmation tokens do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(newConfirmation(DOC, NOW).token);
  assert.equal(seen.size, 2000);
});

test("a new confirmation starts unused and bound to its document", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(c.used, false);
  assert.equal(c.documentId, DOC);
  assert.equal(c.expiresAt, NOW + CONFIRMATION_TTL_MS);
});
