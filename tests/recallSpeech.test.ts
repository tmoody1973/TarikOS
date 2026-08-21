import { test } from "node:test";
import assert from "node:assert/strict";
import { recallMessage } from "../src/lib/recallSpeech.ts";

test("with nothing found and nothing close, she just says no", () => {
  assert.match(recallMessage(0, []), /^Nothing in the second brain matches that\./);
});

test("the no comes before the near miss, never after", () => {
  // THE rule. An embedding always returns its nearest row, so leading with that
  // row is how recall starts lying confidently.
  const msg = recallMessage(0, ["something vaguely adjacent"]);
  const no = msg.indexOf("Nothing");
  const near = msg.indexOf("nearest");
  assert.ok(no > -1, "she no longer says she has nothing");
  assert.ok(near > -1, "the near miss vanished");
  assert.ok(no < near, "the near miss is offered before the no");
});

test("a near miss is labelled as only near", () => {
  assert.match(recallMessage(0, ["adjacent thing"]), /only near/);
});

test("a real hit says nothing about near misses", () => {
  const msg = recallMessage(3, ["adjacent thing"]);
  assert.doesNotMatch(msg, /near|Nothing/i);
});
