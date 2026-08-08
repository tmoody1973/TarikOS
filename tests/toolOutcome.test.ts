import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOutcome, TOOL_OUTCOMES } from "../src/lib/toolOutcome.ts";

// Four sites in the tool route return `ok: true` for a non-result, and a
// disabled tool returns HTTP 200. Recording those as successes would corrupt
// the eval dataset. `ok` is what Zola speaks from and must not change, so the
// real outcome rides on a separate field.

test("plain success", () => {
  assert.equal(classifyOutcome({ ok: true }), "success");
});

test("plain failure", () => {
  assert.equal(classifyOutcome({ ok: false }), "error");
});

test("explicit outcome wins over ok:true", () => {
  assert.equal(classifyOutcome({ ok: true, outcome: "no_match" }), "no_match");
  assert.equal(classifyOutcome({ ok: true, outcome: "ambiguous" }), "ambiguous");
  assert.equal(classifyOutcome({ ok: true, outcome: "disabled" }), "disabled");
});

test("explicit outcome wins over ok:false", () => {
  assert.equal(classifyOutcome({ ok: false, outcome: "disabled" }), "disabled");
});

// The four real sites this exists for, as they actually return today.
test("the four ok:true non-result sites classify as non-successes", () => {
  // update_calendar_event not_found
  assert.equal(classifyOutcome({ ok: true, outcome: "no_match" }), "no_match");
  // update_calendar_event ambiguous
  assert.equal(classifyOutcome({ ok: true, outcome: "ambiguous" }), "ambiguous");
  // update_telos_item not_found
  assert.equal(classifyOutcome({ ok: true, outcome: "no_match" }), "no_match");
  // get_brief with no brief ready
  assert.equal(classifyOutcome({ ok: true, outcome: "no_match" }), "no_match");
});

test("every outcome in TOOL_OUTCOMES round-trips", () => {
  for (const outcome of TOOL_OUTCOMES) {
    assert.equal(classifyOutcome({ ok: true, outcome }), outcome);
  }
});
