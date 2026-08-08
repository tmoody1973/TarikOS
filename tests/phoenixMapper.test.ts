import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapPostCall, shouldProcess } from "../src/lib/phoenixMapper.ts";

// ElevenLabs attaches tool_calls to the turn that produced them, server-side.
// That is what makes tool-selection eval possible without threading a trace id
// from the browser through the agent into every webhook body.

const payload = JSON.parse(
  readFileSync(new URL("./fixtures/post-call-payload.json", import.meta.url), "utf8"),
);

test("maps a conversation to a root span", () => {
  const root = mapPostCall(payload);
  assert.ok(root);
  assert.equal(root.name, "conversation");
  assert.equal(root.attributes["conversation.id"], "conv_xyz");
  assert.equal(root.attributes["conversation.duration_secs"], 22);
  assert.equal(root.attributes["conversation.cost"], 296);
  assert.equal(root.attributes["conversation.summary"], "Tarik asked about the station project.");
});

test("root span spans the whole call", () => {
  const root = mapPostCall(payload)!;
  assert.equal(root.startMs, 1739537297000);
  assert.equal(root.endMs, 1739537297000 + 22000);
});

test("creates one child span per turn", () => {
  const root = mapPostCall(payload)!;
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0].attributes["turn.role"], "user");
  assert.equal(
    root.children[0].attributes["turn.message"],
    "what did I say about the station project last week?",
  );
  assert.equal(root.children[1].attributes["turn.role"], "agent");
});

test("nests tool calls under the turn that made them", () => {
  const root = mapPostCall(payload)!;
  assert.equal(root.children[0].children.length, 0, "user turn made no tool calls");
  const agentTurn = root.children[1];
  assert.equal(agentTurn.children.length, 1);
  assert.equal(agentTurn.children[0].name, "tool.recall");
  assert.equal(agentTurn.children[0].attributes["tool.name"], "recall");
  assert.equal(agentTurn.children[0].attributes["tool.args"], '{"query":"station project"}');
  assert.equal(agentTurn.children[0].attributes["tool.result"], "2 memories found");
  assert.equal(agentTurn.children[0].attributes["tool.is_error"], false);
});

test("carries per-turn latency when present", () => {
  const root = mapPostCall(payload)!;
  assert.equal(root.children[1].attributes["turn.llm_ttfb_secs"], 0.37);
  assert.equal(root.children[0].attributes["turn.llm_ttfb_secs"], undefined);
});

test("turn start times are offset from call start", () => {
  const root = mapPostCall(payload)!;
  assert.equal(root.children[0].startMs, 1739537297000 + 2000);
  assert.equal(root.children[1].startMs, 1739537297000 + 5000);
});

test("returns null for a non-transcription event", () => {
  assert.equal(mapPostCall({ type: "post_call_audio", data: {} }), null);
});

test("returns null rather than throwing on garbage", () => {
  assert.equal(mapPostCall(null), null);
  assert.equal(mapPostCall(undefined), null);
  assert.equal(mapPostCall("nope"), null);
  assert.equal(mapPostCall(42), null);
  assert.equal(mapPostCall({ type: "post_call_transcription" }), null);
  assert.equal(
    mapPostCall({ type: "post_call_transcription", data: { transcript: "not-an-array" } }),
    null,
  );
});

test("survives a transcript full of malformed turns", () => {
  const root = mapPostCall({
    type: "post_call_transcription",
    data: {
      conversation_id: "c1",
      transcript: [null, {}, { tool_calls: "not-an-array" }, { tool_calls: [{}] }],
    },
  });
  assert.ok(root);
  assert.equal(root.children.length, 4);
  // A tool call with no name still produces a span rather than crashing.
  assert.equal(root.children[3].children[0].name, "tool.unknown");
});

test("shouldProcess requires both a signature and a secret", () => {
  assert.equal(shouldProcess(null, "secret"), false);
  assert.equal(shouldProcess(undefined, "secret"), false);
  assert.equal(shouldProcess("", "secret"), false);
  assert.equal(shouldProcess("t=1,v0=abc", undefined), false);
  assert.equal(shouldProcess("t=1,v0=abc", ""), false);
  assert.equal(shouldProcess("t=1,v0=abc", "secret"), true);
});
