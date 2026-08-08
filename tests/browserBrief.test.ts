import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browseSections } from "../src/lib/browserBrief.ts";

// Structural guardrails (MOO-485), same pattern as the mail no-send scan:
// the runner must always carry the no-credentials rules into the agent
// instruction, and sessions must stay bare (no persisted auth contexts).
test("runner instruction always carries the no-credentials guardrails", () => {
  const src = readFileSync(
    new URL("../src/app/api/browser/run/route.ts", import.meta.url),
    "utf8",
  );
  assert.ok(/NEVER type into password/.test(src));
  assert.ok(/TAKEOVER:/.test(src));
  assert.ok(/\$\{GUARDRAILS\}/.test(src));
});

test("browser sessions are always bare — no persisted auth context", () => {
  const src = readFileSync(
    new URL("../src/lib/browserSession.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!/contextId|browserSettings.*context/.test(src));
});

const base = {
  task: "find the top HN story",
  resultMessage: "The top story is X, covered on two sites.",
  urls: [
    "https://news.ycombinator.com/",
    "https://news.ycombinator.com/item?id=1",
    "https://example-blog.test/post",
  ],
  replayUrl: "https://browserbase.com/sessions/abc",
  now: 1700000000000,
};

test("findings section carries the agent result and visited sources", () => {
  const sections = browseSections(base);
  const findings = sections.find((s) => s.heading === "FINDINGS");
  assert.ok(findings);
  assert.equal(findings.body, base.resultMessage);
  assert.equal(findings.tool, "browse");
  assert.equal(findings.updatedAt, base.now);
  assert.deepEqual(
    findings.sources.map((s) => s.url),
    base.urls,
  );
  assert.equal(findings.sources[0].title, "news.ycombinator.com");
});

test("replay section links the session recording", () => {
  const sections = browseSections(base);
  const replay = sections.find((s) => s.heading === "SESSION REPLAY");
  assert.ok(replay);
  assert.deepEqual(replay.sources, [
    { title: "Watch the session replay", url: base.replayUrl },
  ]);
});

test("duplicate and about:blank urls are dropped from sources", () => {
  const sections = browseSections({
    ...base,
    urls: ["about:blank", base.urls[0], base.urls[0]],
  });
  const findings = sections.find((s) => s.heading === "FINDINGS")!;
  assert.deepEqual(
    findings.sources.map((s) => s.url),
    [base.urls[0]],
  );
});

test("error variant reports the failure but keeps the replay", () => {
  const sections = browseSections({ ...base, error: "task timed out" });
  const findings = sections.find((s) => s.heading === "FINDINGS")!;
  assert.ok(findings.body.includes("task timed out"));
  assert.ok(sections.some((s) => s.heading === "SESSION REPLAY"));
});
