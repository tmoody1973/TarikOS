import { test } from "node:test";
import assert from "node:assert/strict";
import {
  livePostCallSchema,
  mapLiveCall,
  type LivePostCall,
} from "../src/lib/voice/livePostCall.ts";
import { LIVE_USD_PER_MINUTE } from "../src/lib/voice/liveSession.ts";

/* Phase 2 of the GPT-Live migration: the browser's timeline becomes the same
 * conversation trace the ElevenLabs post-call webhook produced. */

const sample: LivePostCall = {
  sessionId: "live_abc",
  startedAt: 1_800_000_000_000,
  seconds: 42,
  reason: "close_requested",
  voice: "shimmer",
  transport: "webrtc",
  turns: [
    { role: "tarik", text: "what's on my calendar", startMs: 1000, endMs: 2500 },
    { role: "morpheus", text: "Two things today.", startMs: 6000, endMs: 8000 },
  ],
  tools: [
    { name: "get_calendar", args: { date: "" }, ok: true, startMs: 3000, endMs: 5200, result: '{"ok":true}' },
    { name: "remember", args: {}, ok: false, startMs: 7000, endMs: 7300, result: '{"ok":false}' },
  ],
};

test("the schema accepts the browser payload and rejects a stranger", () => {
  assert.ok(livePostCallSchema.safeParse(sample).success);
  assert.ok(!livePostCallSchema.safeParse({ ...sample, turns: [{ role: "bot", text: "", startMs: 0, endMs: 0 }] }).success);
  assert.ok(!livePostCallSchema.safeParse({ ...sample, transport: "carrier-pigeon" }).success);
  assert.ok(!livePostCallSchema.safeParse({ type: "post_call_transcription" }).success);
});

test("conversation root carries provider, transport, duration and cost", () => {
  const root = mapLiveCall(sample);
  assert.equal(root.name, "conversation");
  assert.equal(root.attributes["openinference.span.kind"], "AGENT");
  assert.equal(root.attributes["conversation.id"], "live_abc");
  assert.equal(root.attributes["conversation.provider"], "openai");
  assert.equal(root.attributes["conversation.transport"], "webrtc");
  assert.equal(root.attributes["conversation.duration_secs"], 42);
  assert.equal(root.attributes["conversation.cost"], Number(((42 / 60) * LIVE_USD_PER_MINUTE).toFixed(4)));
  assert.equal(root.endMs - root.startMs, 42_000);
});

test("tools nest under the turn they started in, with their outcome", () => {
  const root = mapLiveCall(sample);
  assert.equal(root.children.length, 2);
  const [user, agent] = root.children;
  assert.equal(user.attributes["turn.role"], "user");
  assert.deepEqual(user.children.map((c) => c.name), ["tool.get_calendar"]);
  assert.equal(user.children[0].attributes["tool.is_error"], false);
  assert.equal(agent.attributes["turn.role"], "agent");
  assert.deepEqual(agent.children.map((c) => c.name), ["tool.remember"]);
  assert.equal(agent.children[0].attributes["tool.is_error"], true);
  assert.equal(user.children[0].startMs, sample.startedAt + 3000);
});
