import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldEscalate } from "../src/lib/readerEscalation.ts";

// Every escalation costs a Firecrawl credit, so this decision has a price.
// It must fire on bot walls and stay quiet on everything else.

test("bot-wall status codes escalate", () => {
  for (const status of [401, 403, 429, 451]) {
    assert.equal(
      shouldEscalate({ status, extractedChars: 0 }),
      true,
      `${status} should escalate`
    );
  }
});

test("a successful fetch with real text never escalates", () => {
  assert.equal(shouldEscalate({ status: 200, extractedChars: 4000 }), false);
});

test("a 200 that extracts to nothing escalates — the shell served to bots", () => {
  assert.equal(shouldEscalate({ status: 200, extractedChars: 12 }), true);
});

test("a genuinely missing page does not escalate", () => {
  // Firecrawl can't conjure a 404 into existence; paying for it is waste.
  assert.equal(shouldEscalate({ status: 404, extractedChars: 0 }), false);
  assert.equal(shouldEscalate({ status: 410, extractedChars: 0 }), false);
});

test("server errors do not escalate", () => {
  // The origin is broken, not blocking us.
  assert.equal(shouldEscalate({ status: 500, extractedChars: 0 }), false);
  assert.equal(shouldEscalate({ status: 503, extractedChars: 0 }), false);
});

test("a network failure with no status escalates once", () => {
  // Connection reset mid-handshake is a common shape of blocking.
  assert.equal(shouldEscalate({ status: null, extractedChars: 0 }), true);
});

test("the char floor matches the extractor's own minimum", () => {
  assert.equal(shouldEscalate({ status: 200, extractedChars: 199 }), true);
  assert.equal(shouldEscalate({ status: 200, extractedChars: 200 }), false);
});
