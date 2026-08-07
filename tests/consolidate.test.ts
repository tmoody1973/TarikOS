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
  journal: [],
  telosItems: [],
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
  assert.deepEqual(ops, {
    newMemories: [],
    updates: [],
    deletes: [],
    telosUpdates: [],
  });
});

// ---- MOO-489: journal input + telos_updates ----

const telosInput: ConsolidationInput = {
  ...input,
  journal: [
    { id: "j1", text: "Did 30 minutes of Python practice tonight", mode: "capture" },
  ],
  telosItems: [
    { id: "t1", kind: "goal", text: "Improve Python skills", status: "active" },
  ],
};

test("buildPrompt includes journal entries and telos items", () => {
  const prompt = buildPrompt(telosInput);
  assert.ok(prompt.includes("Did 30 minutes of Python practice tonight"));
  assert.ok(prompt.includes("[t1] (goal) Improve Python skills"));
});

test("telos_updates validate ids, map empty sentinels, resolve provenance", () => {
  const ops = opsFromResponse(
    {
      new_memories: [],
      updates: [],
      deletes: [],
      telos_updates: [
        {
          telos_id: "t1",
          text: "",
          status: "active",
          measurable: "Daily practice logged this week",
          transcript_index: 0,
        },
        { telos_id: "unknown", text: "dropped", status: "active", measurable: "", transcript_index: -1 },
      ],
    },
    telosInput,
  );
  assert.equal(ops.telosUpdates.length, 1);
  assert.equal(ops.telosUpdates[0].id, "t1");
  assert.equal(ops.telosUpdates[0].text, undefined);
  assert.equal(ops.telosUpdates[0].measurable, "Daily practice logged this week");
  assert.equal(ops.telosUpdates[0].transcriptId, "tr1");
});

test("telos_updates with bad status or no effective change are dropped", () => {
  const ops = opsFromResponse(
    {
      new_memories: [],
      updates: [],
      deletes: [],
      telos_updates: [
        { telos_id: "t1", text: "", status: "banana", measurable: "", transcript_index: -1 },
        { telos_id: "t1", text: "", status: "", measurable: "", transcript_index: -1 },
      ],
    },
    telosInput,
  );
  assert.equal(ops.telosUpdates.length, 0);
});

test("missing telos_updates in the raw response yields empty telosUpdates", () => {
  const ops = opsFromResponse(
    { new_memories: [], updates: [], deletes: [] },
    input,
  );
  assert.deepEqual(ops.telosUpdates, []);
});
