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
  assert.equal(root.children.length, 3);
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
  assert.equal(agentTurn.children.length, 2);
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

// Verified against a real conversation (conv_0601kzheqverfjavgd203js1cy85,
// 2026-08-08): ElevenLabs puts tool_results on a LATER turn than the
// tool_calls that produced them, joined by request_id. Pairing them by index
// within one turn — which the hand-written fixture wrongly implied — finds
// nothing, so `tool.is_error` could only ever evaluate to false.

test("joins a result on a later turn to its call by request_id", () => {
  const root = mapPostCall(payload)!;
  const tools = root.children.flatMap((t) => t.children);
  const recall = tools.find((s) => s.name === "tool.recall")!;
  assert.ok(recall, "the recall tool span must exist");
  assert.equal(recall.attributes["tool.result"], "2 memories found");
  assert.equal(recall.attributes["tool.is_error"], false);
});

test("a failed tool actually reports is_error true", () => {
  const root = mapPostCall(payload)!;
  const tools = root.children.flatMap((t) => t.children);
  const calendar = tools.find((s) => s.name === "tool.get_calendar")!;
  assert.equal(calendar.attributes["tool.is_error"], true);
  assert.equal(calendar.attributes["tool.error_type"], "timeout");
  assert.equal(calendar.attributes["tool.error_message"], "upstream timed out");
});

test("tool spans carry real duration from tool_latency_secs", () => {
  const root = mapPostCall(payload)!;
  const tools = root.children.flatMap((t) => t.children);
  const recall = tools.find((s) => s.name === "tool.recall")!;
  assert.equal(recall.endMs - recall.startMs, 2500);
});

test("spans carry an OpenInference kind so Phoenix can classify them", () => {
  // Without this, every span renders as "unknown" and any eval filtering on
  // span_kind returns nothing while appearing correctly configured.
  const root = mapPostCall(payload)!;
  assert.equal(root.attributes["openinference.span.kind"], "AGENT");
  assert.equal(root.children[0].attributes["openinference.span.kind"], "CHAIN");
  const tool = root.children.flatMap((t) => t.children)[0];
  assert.equal(tool.attributes["openinference.span.kind"], "TOOL");
});

test("a call with no matching result is not silently marked successful", () => {
  const orphan = {
    type: "post_call_transcription",
    data: {
      transcript: [
        {
          role: "agent",
          tool_calls: [{ request_id: "never_answered", tool_name: "browse" }],
          tool_results: [],
          time_in_call_secs: 1,
        },
      ],
      metadata: { start_time_unix_secs: 1739537297, call_duration_secs: 5 },
    },
  };
  const tool = mapPostCall(orphan)!.children[0].children[0];
  assert.equal(tool.attributes["tool.is_error"], undefined);
  assert.equal(tool.attributes["tool.no_result"], true);
});
