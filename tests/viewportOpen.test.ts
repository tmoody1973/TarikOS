import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAutoOpen } from "../src/lib/viewportOpen.ts";

// The Viewport covers the dashboard, so "should it open itself?" is a real
// decision with a wrong answer: a session that was already there when the page
// loaded must not take the screen. Its Browserbase live view is usually a
// corpse by then (the debugger socket is gone → "WebSocket disconnected").

test("a session that arrived after mount opens — this is the VIEW click", () => {
  assert.equal(
    shouldAutoOpen({ status: "idle", sessionId: "new", preexistingId: null }),
    true
  );
});

test("a session that already existed at mount does not open on login", () => {
  assert.equal(
    shouldAutoOpen({ status: "idle", sessionId: "old", preexistingId: "old" }),
    false
  );
});

test("a running session that arrived after mount opens", () => {
  assert.equal(
    shouldAutoOpen({ status: "running", sessionId: "b", preexistingId: "a" }),
    true
  );
});

test("a pre-existing running session stays out of the way", () => {
  // Zola may still be working, but the user asked for the dashboard by
  // loading it. The reopen tab is how they get in.
  assert.equal(
    shouldAutoOpen({ status: "running", sessionId: "a", preexistingId: "a" }),
    false
  );
});

test("needs_takeover always opens, even pre-existing — she is blocked on a human", () => {
  assert.equal(
    shouldAutoOpen({
      status: "needs_takeover",
      sessionId: "a",
      preexistingId: "a",
    }),
    true
  );
});

test("terminal statuses never open", () => {
  for (const status of ["done", "error"] as const) {
    assert.equal(
      shouldAutoOpen({ status, sessionId: "new", preexistingId: null }),
      false,
      `${status} must not open`
    );
  }
});
