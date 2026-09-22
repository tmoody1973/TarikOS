import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_CALL_STATE,
  parseArguments,
  reduceCallEvent,
} from "../src/lib/voice/liveCalls.ts";
import { LIVE_TOOLS } from "../src/lib/voice/liveTools.generated.ts";
import { BROWSER_TOOLS } from "../src/lib/voice/liveToolTypes.ts";
import { PAGES, resolveNavigation } from "../src/lib/voice/navigation.ts";

/* Phase 1 of the GPT-Live migration: the tool loop's state machine, the
 * generated tool list, and page navigation. All pure. */

test("calls collect per backend response and release on completed", () => {
  let s = reduceCallEvent(EMPTY_CALL_STATE, {
    type: "response.output_item.done",
    response: { id: "resp_1" },
    item: { type: "function_call", call_id: "call_a", name: "get_brief", arguments: "{}" },
  });
  assert.equal(s.ready, undefined);
  // A message item is not a call.
  s = reduceCallEvent(s.state, {
    type: "response.output_item.done",
    response: { id: "resp_1" },
    item: { type: "message" },
  });
  s = reduceCallEvent(s.state, { type: "response.completed", response: { id: "resp_1" } });
  assert.deepEqual(s.ready, [{ callId: "call_a", name: "get_brief", arguments: "{}" }]);
  assert.deepEqual(s.state, EMPTY_CALL_STATE);
});

test("a completed response with no calls releases nothing, a failed one drops them", () => {
  const empty = reduceCallEvent(EMPTY_CALL_STATE, {
    type: "response.completed",
    response: { id: "r" },
  });
  assert.equal(empty.ready, undefined);
  let s = reduceCallEvent(EMPTY_CALL_STATE, {
    type: "response.output_item.done",
    response: { id: "r2" },
    item: { type: "function_call", call_id: "c", name: "remember", arguments: "{}" },
  });
  s = reduceCallEvent(s.state, { type: "response.failed", response: { id: "r2" } });
  assert.equal(s.ready, undefined);
  assert.deepEqual(s.state, {});
});

test("parseArguments tolerates bad JSON and non-objects", () => {
  assert.deepEqual(parseArguments('{"page":"briefs"}'), { page: "briefs" });
  assert.deepEqual(parseArguments("not json"), {});
  assert.deepEqual(parseArguments("[1,2]"), {});
});

test("generated tool list: 54 unique functions, browser tools included", () => {
  assert.equal(LIVE_TOOLS.length, 54);
  const names = LIVE_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of LIVE_TOOLS) {
    assert.equal(t.type, "function");
    assert.equal(t.parameters.type, "object");
    assert.deepEqual(Object.keys(t).sort(), ["description", "name", "parameters", "type"]);
  }
  for (const b of BROWSER_TOOLS) assert.ok(names.includes(b), b);
  const nav = LIVE_TOOLS.find((t) => t.name === "navigate_ui")!;
  const page = nav.parameters.properties.page as { enum?: string[] };
  assert.ok(page.enum?.includes("graph"));
  // Every page the tool may name resolves to a path.
  for (const p of page.enum ?? []) assert.ok(PAGES[p], p);
});

test("resolveNavigation: plain pages, brief targets, graph focus, unknown", () => {
  assert.deepEqual(resolveNavigation({ page: "telos" }), {
    path: "/telos",
    message: "Navigated to telos.",
  });
  assert.equal(
    resolveNavigation({ page: "briefs", target: "weekly review" }).path,
    "/briefs?open=weekly%20review",
  );
  assert.equal(
    resolveNavigation({ page: "graph", target: "HYFIN" }).path,
    "/brain?view=graph&focus=HYFIN",
  );
  const unknown = resolveNavigation({ page: "settings" });
  assert.equal(unknown.path, null);
  assert.ok(unknown.message.startsWith('Unknown page "settings"'));
});
