import { test } from "node:test";
import assert from "node:assert/strict";
import { trace, type Context } from "@opentelemetry/api";
import { emitConversationSpans } from "../src/lib/emitSpans.ts";
import type { ConversationSpan } from "../src/lib/phoenixMapper.ts";

// The nesting assertions here exist because startSpan() alone creates a ROOT
// span. Without context propagation a conversation renders in Phoenix as a
// flat pile of unrelated spans, which looks fine in code review and is useless
// in the UI.

type Recorded = {
  name: string;
  parent: string | undefined;
  startTime: unknown;
  endTime: unknown;
  attrs: Record<string, unknown>;
};

function fakeTracer(recorded: Recorded[]) {
  let counter = 0;
  return {
    startSpan(name: string, options?: { startTime?: number }, ctx?: Context) {
      const id = `span-${counter++}`;
      // Parent comes from the explicitly-passed context, which is exactly how
      // emitSpans threads it — no ambient context manager required.
      const parentSpan = ctx ? (trace.getSpan(ctx) as { __id?: string } | undefined) : undefined;
      const entry: Recorded = {
        name,
        parent: parentSpan?.__id,
        startTime: options?.startTime,
        endTime: undefined,
        attrs: {},
      };
      recorded.push(entry);
      return makeSpan(id, entry);
    },
  } as never;

  function makeSpan(id: string, entry: Recorded) {
    const span = {
      __id: id,
      setAttribute(k: string, v: unknown) {
        entry.attrs[k] = v;
      },
      setStatus() {},
      recordException() {},
      end(endTime?: number) {
        entry.endTime = endTime;
      },
      // Minimal SpanContext so trace.setSpan/getSpan round-trips.
      spanContext() {
        return { traceId: "t".repeat(32), spanId: id.padEnd(16, "0"), traceFlags: 1 };
      },
    };
    return span;
  }
}

const tree: ConversationSpan = {
  name: "conversation",
  attributes: { "conversation.id": "conv_xyz" },
  startMs: 1000,
  endMs: 23000,
  children: [
    {
      name: "turn",
      attributes: { "turn.role": "user" },
      startMs: 3000,
      endMs: 3000,
      children: [],
    },
    {
      name: "turn",
      attributes: { "turn.role": "agent" },
      startMs: 6000,
      endMs: 6000,
      children: [
        {
          name: "tool.recall",
          attributes: { "tool.name": "recall" },
          startMs: 6000,
          endMs: 6000,
          children: [],
        },
      ],
    },
  ],
};

test("emits one span per node", () => {
  const recorded: Recorded[] = [];
  emitConversationSpans(tree, fakeTracer(recorded));
  assert.equal(recorded.length, 4);
  assert.deepEqual(
    recorded.map((r) => r.name),
    ["conversation", "turn", "turn", "tool.recall"],
  );
});

test("turns nest under the conversation, not as roots", () => {
  const recorded: Recorded[] = [];
  emitConversationSpans(tree, fakeTracer(recorded));
  const [conversation, userTurn, agentTurn] = recorded;
  assert.equal(conversation.parent, undefined, "conversation is the root");
  assert.equal(userTurn.parent, "span-0", "user turn nests under conversation");
  assert.equal(agentTurn.parent, "span-0", "agent turn nests under conversation");
});

test("tool calls nest under the turn that made them", () => {
  const recorded: Recorded[] = [];
  emitConversationSpans(tree, fakeTracer(recorded));
  const toolSpan = recorded[3];
  assert.equal(toolSpan.parent, "span-2", "tool nests under the agent turn, not the conversation");
});

test("start and end times come from the payload, not the clock", () => {
  const recorded: Recorded[] = [];
  emitConversationSpans(tree, fakeTracer(recorded));
  assert.equal(recorded[0].startTime, 1000);
  assert.equal(recorded[0].endTime, 23000);
  assert.equal(recorded[3].startTime, 6000);
});

test("attributes reach the span", () => {
  const recorded: Recorded[] = [];
  emitConversationSpans(tree, fakeTracer(recorded));
  assert.equal(recorded[0].attrs["conversation.id"], "conv_xyz");
  assert.equal(recorded[3].attrs["tool.name"], "recall");
});

test("a throwing tracer does not propagate", () => {
  const explodingTracer = {
    startSpan() {
      throw new Error("tracer exploded");
    },
  } as never;
  assert.doesNotThrow(() => emitConversationSpans(tree, explodingTracer));
});
