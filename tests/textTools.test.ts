import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXCLUDED_FROM_TEXT, TEXT_TOOLS } from "../src/lib/textTools.ts";

// Two lists of tools now exist: the ones ElevenLabs is provisioned with, and
// the ones Claude is handed on the text channel. They are separate because
// provision-agent.ts throws at import time without TOOL_BASE_URL, so a route
// cannot safely import it — which means nothing but this test stops them
// drifting apart.

const provision = readFileSync(
  new URL("../scripts/provision-agent.ts", import.meta.url),
  "utf8",
);
const published = [...provision.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]);

const route = readFileSync(
  new URL("../src/app/api/telegram/inbound/route.ts", import.meta.url),
  "utf8",
);

test("the published tool list was actually found", () => {
  // If the regex stops matching, every assertion below passes vacuously.
  assert.ok(published.length > 20, `only found ${published.length} tools`);
});

test("every text tool is a tool the agent really has", () => {
  for (const tool of TEXT_TOOLS) {
    assert.ok(
      published.includes(tool.name),
      `${tool.name} is offered to Claude but is not published to the agent — ` +
        `the webhook may not exist`,
    );
  }
});

test("nothing deliberately withheld has crept back in", () => {
  const offered = TEXT_TOOLS.map((t) => t.name);
  for (const name of EXCLUDED_FROM_TEXT) {
    assert.ok(
      !offered.includes(name),
      `${name} is excluded from text for a documented reason — see textTools.ts`,
    );
  }
});

test("sharing is not reachable from the text channel", () => {
  // The confirm gate is two calls with a spoken yes between them. Until that
  // ritual is designed for text, a share must not be one message away.
  const offered = TEXT_TOOLS.map((t) => t.name);
  assert.ok(!offered.includes("share_document"));
  assert.ok(!/share_document/.test(route.replace(/\/\/.*$/gm, "")));
});

test("every tool declares a schema Claude can actually call", () => {
  for (const tool of TEXT_TOOLS) {
    assert.equal(tool.input_schema.type, "object", tool.name);
    assert.ok(tool.description.length > 30, `${tool.name} needs a real description`);
    for (const required of tool.input_schema.required ?? []) {
      assert.ok(
        required in tool.input_schema.properties,
        `${tool.name} requires "${required}" but does not define it`,
      );
    }
  }
});

test("tool names are unique", () => {
  const names = TEXT_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test("the loop is bounded and ends in words", () => {
  const code = route.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /MAX_TOOL_ROUNDS\s*=\s*\d+/, "the loop must be capped");
  assert.match(
    code,
    /tool_choice/,
    "the last round must withhold tools, or a final tool call is silently dropped " +
      "and he gets no answer at all",
  );
});

test("tools are called through the one webhook surface", () => {
  // No second implementation of a tool. Voice and text go through one door,
  // so a guardrail on the route protects both.
  assert.match(route, /\/api\/tools\/\$\{name\}/);
  assert.match(route, /x-morpheus-secret/);
});
