import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  opsFromResponse,
  type ConsolidationInput,
} from "../src/lib/consolidate.ts";

const input: ConsolidationInput = {
  transcripts: [
    {
      id: "tr1",
      title: "Morning chat",
      turns: [{ role: "tarik", text: "My co-host is named Jordan." }],
    },
  ],
  memories: [
    { id: "m1", content: "Tarik hosts a radio show", type: "project" },
    { id: "m2", content: "Tarik hosts a show on the radio", type: "project" },
  ],
};

test("buildPrompt includes memories with ids and indexed transcripts", () => {
  const prompt = buildPrompt(input);
  assert.ok(prompt.includes("[m1] (project) Tarik hosts a radio show"));
  assert.ok(prompt.includes("Transcript 0: Morning chat"));
  assert.ok(prompt.includes("tarik: My co-host is named Jordan."));
});

test("opsFromResponse resolves provenance and validates ids", () => {
  const ops = opsFromResponse(
    {
      new_memories: [
        { content: "Tarik's co-host is Jordan", type: "person", transcript_index: 0 },
        { content: "bad type", type: "banana", transcript_index: 0 },
        { content: "", type: "fact", transcript_index: 0 },
      ],
      updates: [
        { memory_id: "m1", content: "Tarik hosts a radio show with Jordan" },
        { memory_id: "unknown", content: "should be dropped" },
      ],
      deletes: ["m2", "not-a-real-id"],
    },
    input,
  );
  assert.equal(ops.newMemories.length, 1);
  assert.equal(ops.newMemories[0].transcriptId, "tr1");
  assert.deepEqual(ops.updates, [
    { id: "m1", content: "Tarik hosts a radio show with Jordan" },
  ]);
  assert.deepEqual(ops.deletes, ["m2"]);
});

test("a memory being updated is never also deleted", () => {
  const ops = opsFromResponse(
    {
      new_memories: [],
      updates: [{ memory_id: "m1", content: "updated" }],
      deletes: ["m1"],
    },
    input,
  );
  assert.deepEqual(ops.deletes, []);
  assert.equal(ops.updates.length, 1);
});

test("empty response yields empty ops", () => {
  const ops = opsFromResponse({}, input);
  assert.deepEqual(ops, { newMemories: [], updates: [], deletes: [] });
});
