import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendDelta,
  BACKEND_INSTRUCTIONS,
  buildLiveSessionConfig,
  DEFAULT_VOICE,
  isLiveVoice,
  LIVE_MODEL,
  VOICE_INSTRUCTIONS,
} from "../src/lib/voice/liveSession.ts";
import { LIVE_TOOLS } from "../src/lib/voice/liveTools.generated.ts";

/* Phase 1 of the GPT-Live migration. The session config is the contract with
 * OpenAI: the voice model, the Responses backend that picks tools, the split
 * prompts, and the generated tool list. */

test("session config uses gpt-live-1 with a Responses backend carrying every tool", () => {
  const config = buildLiveSessionConfig();
  assert.equal(config.model, LIVE_MODEL);
  assert.equal(config.delegation?.type, "responses");
  const responses =
    config.delegation?.type === "responses" ? config.delegation.responses : null;
  assert.ok(responses?.model, "backend model is set");
  assert.equal(responses?.parallel_tool_calls, false);
  assert.equal(responses?.tools?.length, LIVE_TOOLS.length);
  assert.equal(config.audio?.output?.voice, DEFAULT_VOICE);
  assert.equal(DEFAULT_VOICE, "shimmer");
});

test("the prompt is split: tone and delegation in voice, rules in backend", () => {
  for (const heading of [
    "Backchannel policy:",
    "Interruption policy:",
    "Delegation policy:",
  ]) {
    assert.ok(VOICE_INSTRUCTIONS.includes(heading), heading);
  }
  assert.ok(!/\[(sighs|laughs|whispers)\]/.test(VOICE_INSTRUCTIONS));
  assert.ok(BACKEND_INSTRUCTIONS.includes("NEVER send email"));
  assert.ok(BACKEND_INSTRUCTIONS.includes("create_plane_project returns a BLUEPRINT"));
  assert.ok(BACKEND_INSTRUCTIONS.includes("MORNING BRIEFING"));
  assert.ok(!VOICE_INSTRUCTIONS.includes("create_plane_project"));
});

test("standing context reaches both prompts only when provided", () => {
  const plain = buildLiveSessionConfig();
  assert.ok(!plain.instructions?.includes("Standing context"));
  const withContext = buildLiveSessionConfig({ standingContext: "- [fact] He likes tea" });
  assert.ok(withContext.instructions?.endsWith("- [fact] He likes tea"));
  const backend =
    withContext.delegation?.type === "responses"
      ? withContext.delegation.responses.instructions
      : "";
  assert.ok(backend?.endsWith("- [fact] He likes tea"));
});

test("voice validation accepts documented names and rejects others", () => {
  assert.ok(isLiveVoice("marin"));
  assert.ok(isLiveVoice("shimmer"));
  assert.ok(!isLiveVoice("zola"));
  assert.ok(!isLiveVoice(42));
  assert.equal(
    buildLiveSessionConfig({ voice: "delta" }).audio?.output?.voice,
    "delta",
  );
});

test("appendDelta groups consecutive fragments by speaker without mutating", () => {
  const a = appendDelta([], "tarik", "hey ");
  const b = appendDelta(a, "tarik", "zola");
  const c = appendDelta(b, "morpheus", "hi");
  assert.deepEqual(a, [{ role: "tarik", text: "hey " }]);
  assert.deepEqual(c, [
    { role: "tarik", text: "hey zola" },
    { role: "morpheus", text: "hi" },
  ]);
});
