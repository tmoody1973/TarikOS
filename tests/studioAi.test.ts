import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Studio's AI editing route (Phase 3).
//
// Comments stripped before every scan — a guardrail in this repo once passed
// three times while guarding nothing, because it matched the word it was
// looking for inside the comment explaining the guard.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const ROUTE = CODE("src/app/api/studio/ai/route.ts");
const PROXY = CODE("src/proxy.ts");

test("the route is behind a session, unlike the tool webhooks", () => {
  // /api/tools is exempt from Clerk because ElevenLabs authenticates with a
  // shared secret. This route has a browser behind it and must not join that
  // exemption — an open one would bill Tarik's key for anyone who finds it.
  assert.ok(
    !/api\/studio/.test(PROXY),
    "the AI route must not be added to the public route matcher",
  );
  assert.match(ROUTE, /await auth\(\)/);
  assert.match(ROUTE, /401/);
});

test("a missing key is reported, not turned into a stack trace", () => {
  // ANTHROPIC_API_KEY exists in both environments today, but the failure when
  // it does not has to read as "not configured" rather than a 500.
  assert.match(ROUTE, /ANTHROPIC_API_KEY/);
  assert.match(ROUTE, /503/);
});

test("the writing is done by Claude, not a gateway default", () => {
  // Plate's example defaults to openai/gpt-4o-mini through the Vercel AI
  // Gateway. This is Zola's own voice and Tarik's existing key.
  assert.match(ROUTE, /claude-/);
  assert.ok(!/gpt-4o|openai\//.test(ROUTE), "must not fall back to the example model");
  assert.ok(!/createGateway/.test(ROUTE), "must not require an AI Gateway key");
});

test("the instructions come from the shared prompt, never inline here", () => {
  // Voice will reuse the same prompt. Two copies would let the editor and Zola
  // drift into being different editors.
  assert.match(ROUTE, /studioSystemPrompt\(/);
  assert.ok(!/You are Zola/.test(ROUTE), "the prompt must not be duplicated in the route");
});

test("how much document may be sent is bounded", () => {
  // The document is serialized client-side. Without a ceiling, a very long one
  // decides how large a request this route makes and how much it costs.
  // The COMPARISON, not the constant. Asserting that MAX_CONTEXT_CHARS and 413
  // merely appear passed with the `if` neutered to `if (false)` — the constant
  // was still declared and the 413 still sat in the dead branch.
  assert.match(ROUTE, /if \(size > MAX_CONTEXT_CHARS\)/);
  const guard = ROUTE.slice(ROUTE.indexOf("if (size > MAX_CONTEXT_CHARS)"));
  assert.match(guard.slice(0, 260), /413/, "the oversize case must return 413");
  assert.ok(
    ROUTE.indexOf("if (size > MAX_CONTEXT_CHARS)") < ROUTE.indexOf("streamText("),
    "the bound must be checked before the model is called",
  );
});

test("the generation itself is bounded", () => {
  assert.match(ROUTE, /maxOutputTokens/);
});

test("document content never reaches a log line", () => {
  // The same tripwire the contact tools carry. What Tarik writes is the most
  // private thing on this system.
  assert.ok(!/console\.(log|warn|error)/.test(ROUTE));
});

test("only labels are accepted from the client, never ids or bodies", () => {
  // References arrive from the page rather than being re-read here. What is
  // taken from them is narrowed on purpose: a label is a display string, and
  // an id in a prompt is a token a model can only hallucinate variants of.
  assert.match(ROUTE, /sourceType.*label|label.*sourceType/s);
  assert.ok(!/sourceId/.test(ROUTE), "a source id must not be forwarded to the model");
});

test("a malformed body is a 400, not a crash", () => {
  assert.match(ROUTE, /catch\s*\{\s*\n?\s*return new Response\("Bad request"/);
  assert.match(ROUTE, /Array\.isArray\(body\.messages\)/);
});
