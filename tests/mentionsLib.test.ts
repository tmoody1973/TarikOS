import { test } from "node:test";
import assert from "node:assert/strict";
import { keyWords, mentions } from "../convex/mentionsLib.ts";

// The Focus page connects a goal to the decisions, loops and documents that
// bear on it. Only ONE real column links anything to a goal (habits.telosItemId),
// so everything else has to come from somewhere — and ticket 02 forbids
// inference in v1, because inference is the only thing that manufactures a
// review queue.
//
// A word overlap is not an inference. "This decision literally contains the
// words of that goal" is a fact about two strings. It can be shown as a fact,
// labelled as a mention, and it creates no queue and nothing to approve.

test("stop words never carry a match on their own", () => {
  // "Build a system for the work" vs "the work of a system" would otherwise
  // match everything against everything.
  assert.deepEqual(keyWords("the a of and for with into"), []);
});

test("the distinctive words of a goal survive, initialisms included", () => {
  // "AI" is two letters and carries more meaning than anything else in the
  // sentence. A three-letter minimum would drop it, and half his telos is
  // about AI.
  assert.deepEqual(keyWords("Break into AI product work"), ["break", "ai", "product", "work"]);
});

test("a decision naming the goal's words is a mention", () => {
  assert.equal(
    mentions("The portfolio is the main proof of AI product work", "Break into AI product work"),
    true,
  );
});

test("one shared word is not a mention", () => {
  // The bar has to be high enough that a goal about "work" does not swallow
  // every row in the store.
  assert.equal(mentions("Work out on Tuesdays", "Break into AI product work"), false);
});

test("matching ignores case and punctuation", () => {
  assert.equal(mentions("PRODUCT, WORK — and the break", "Break into AI product work"), true);
});

test("an empty goal matches nothing rather than everything", () => {
  // The dangerous default. An empty key set with a permissive check would tag
  // every record in the system as related to a blank goal.
  assert.equal(mentions("anything at all", "the a of"), false);
});
