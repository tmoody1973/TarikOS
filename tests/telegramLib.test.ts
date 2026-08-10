import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CONTEXT_TURNS,
  MAX_TURN_CHARS,
  SESSION_GAP_MS,
  selectContextTurns,
  trimTurn,
  type Turn,
} from "../convex/telegramLib.ts";

// Without this, every text starts a fresh context: "what's on my calendar?"
// then "what about tomorrow?" and the second question means nothing. With too
// much of it, a question asked this afternoon is answered in the frame of a
// conversation from this morning, which is worse than forgetting.

const T0 = Date.parse("2026-08-10T15:00:00Z");
const min = (n: number) => n * 60 * 1000;

const turn = (role: Turn["role"], content: string, at: number): Turn => ({
  role,
  content,
  createdAt: at,
});

test("a live exchange is carried, oldest first", () => {
  const turns = [
    turn("user", "what's on my calendar?", T0 - min(4)),
    turn("assistant", "Two meetings.", T0 - min(4)),
    turn("user", "what about tomorrow?", T0 - min(1)),
  ];
  const kept = selectContextTurns(turns, T0);
  assert.equal(kept.length, 3);
  assert.equal(kept[0].content, "what's on my calendar?");
  assert.equal(kept[2].content, "what about tomorrow?");
});

test("input order does not matter", () => {
  // Convex hands back rows in index order, which is not promised to be time
  // order. Sorting here rather than trusting the caller.
  const turns = [
    turn("user", "second", T0 - min(1)),
    turn("user", "first", T0 - min(5)),
  ];
  assert.deepEqual(
    selectContextTurns(turns, T0).map((t) => t.content),
    ["first", "second"],
  );
});

test("a long silence ends the conversation", () => {
  const turns = [
    turn("user", "this morning's thread", T0 - min(120)),
    turn("assistant", "answered then", T0 - min(120)),
    turn("user", "unrelated question now", T0 - min(1)),
  ];
  const kept = selectContextTurns(turns, T0);
  assert.deepEqual(kept.map((t) => t.content), ["unrelated question now"]);
});

test("the gap is measured between turns, not from the first one", () => {
  // An hour-long thread with no long pause is still one thread. A fixed TTL
  // would cut it in half mid-conversation.
  const turns = [
    turn("user", "a", T0 - min(50)),
    turn("assistant", "b", T0 - min(40)),
    turn("user", "c", T0 - min(25)),
    turn("assistant", "d", T0 - min(10)),
  ];
  assert.equal(selectContextTurns(turns, T0).length, 4);
});

test("silence since the last turn also ends it", () => {
  // The gap before *now* counts too, or a stale thread leads a fresh question.
  const turns = [turn("user", "hours ago", T0 - min(90))];
  assert.deepEqual(selectContextTurns(turns, T0), []);
});

test("context is capped", () => {
  const turns = Array.from({ length: 40 }, (_, i) =>
    turn(i % 2 === 0 ? "user" : "assistant", `m${i}`, T0 - min(20) + i * 1000),
  );
  assert.ok(selectContextTurns(turns, T0).length <= MAX_CONTEXT_TURNS);
});

test("the window never opens on an assistant turn", () => {
  // Handed someone else's answer as the opening move, a model treats it as its
  // own and defends it. The cap can slice mid-exchange, so this trims after.
  const turns = Array.from({ length: 40 }, (_, i) =>
    turn(i % 2 === 0 ? "assistant" : "user", `m${i}`, T0 - min(20) + i * 1000),
  );
  const kept = selectContextTurns(turns, T0);
  assert.ok(kept.length > 0);
  assert.equal(kept[0].role, "user");
});

test("no turns at all is not an error", () => {
  assert.deepEqual(selectContextTurns([], T0), []);
});

test("the session gap is minutes, not days", () => {
  assert.ok(SESSION_GAP_MS >= min(5) && SESSION_GAP_MS <= min(120));
});

test("a turn is trimmed, and a normal one is untouched", () => {
  assert.equal(trimTurn("  hello  "), "hello");
  assert.equal(trimTurn("x".repeat(MAX_TURN_CHARS + 500)).length, MAX_TURN_CHARS);
});
