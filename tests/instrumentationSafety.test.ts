import { test } from "node:test";
import assert from "node:assert/strict";
import { safeSetAttrs, safeEndSpan } from "../src/lib/tracing.ts";

// The observability layer must be strictly non-load-bearing: if it can take
// down Zola it is worse than having none. These tests hold that invariant the
// same way the suite holds "tool route has no send capability" — structurally,
// not by intention.

// A span stand-in that throws on every method, simulating a broken exporter.
const hostileSpan = {
  setAttribute() {
    throw new Error("exporter exploded");
  },
  setStatus() {
    throw new Error("exporter exploded");
  },
  recordException() {
    throw new Error("exporter exploded");
  },
  end() {
    throw new Error("exporter exploded");
  },
} as never;

test("safeSetAttrs swallows a throwing span", () => {
  assert.doesNotThrow(() => safeSetAttrs(hostileSpan, { "tool.name": "recall" }));
});

test("safeEndSpan swallows a throwing span", () => {
  assert.doesNotThrow(() => safeEndSpan(hostileSpan, new Error("boom")));
});

test("undefined span is a no-op", () => {
  assert.doesNotThrow(() => safeSetAttrs(undefined, { a: 1 }));
  assert.doesNotThrow(() => safeEndSpan(undefined));
});

test("circular objects do not throw", () => {
  const circular: Record<string, unknown> = { name: "x" };
  circular.self = circular;
  const seen: Record<string, unknown> = {};
  const span = {
    setAttribute(k: string, v: unknown) {
      seen[k] = v;
    },
    setStatus() {},
    recordException() {},
    end() {},
  } as never;
  assert.doesNotThrow(() => safeSetAttrs(span, { payload: circular }));
  assert.equal(seen.payload, "[unserializable]");
});

test("null and undefined values are skipped, not stringified", () => {
  const seen: Record<string, unknown> = {};
  const span = {
    setAttribute(k: string, v: unknown) {
      seen[k] = v;
    },
    setStatus() {},
    recordException() {},
    end() {},
  } as never;
  safeSetAttrs(span, { kept: "yes", skipped: undefined, alsoSkipped: null });
  assert.deepEqual(Object.keys(seen), ["kept"]);
});

test("primitives pass through untouched, objects are serialized", () => {
  const seen: Record<string, unknown> = {};
  const span = {
    setAttribute(k: string, v: unknown) {
      seen[k] = v;
    },
    setStatus() {},
    recordException() {},
    end() {},
  } as never;
  safeSetAttrs(span, {
    str: "recall",
    num: 42,
    bool: true,
    obj: { query: "station project" },
  });
  assert.equal(seen.str, "recall");
  assert.equal(seen.num, 42);
  assert.equal(seen.bool, true);
  assert.equal(seen.obj, '{"query":"station project"}');
});
