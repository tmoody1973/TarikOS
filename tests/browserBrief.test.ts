import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browseSections } from "../src/lib/browserBrief.ts";

// Structural guardrails (MOO-485), same pattern as the mail no-send scan.
// The agent never types a password — that has not changed. What changed
// (MOO-503) is that a session may now carry Tarik's own saved logins from a
// Browserbase Context, so the rule is re-scoped rather than dropped: bare by
// default, credentials only when this request asked for them.
test("runner instruction always carries the no-credentials guardrails", () => {
  const src = readFileSync(
    new URL("../src/app/api/browser/run/route.ts", import.meta.url),
    "utf8",
  );
  assert.ok(/NEVER type into password/.test(src));
  assert.ok(/TAKEOVER:/.test(src));
  assert.ok(/\$\{GUARDRAILS\}/.test(src));
});

test("sessions are bare unless the caller opts in", () => {
  const src = readFileSync(
    new URL("../src/lib/browserSession.ts", import.meta.url),
    "utf8",
  );
  // The default must be false at the signature — an opt-in that defaults to
  // true is not an opt-in.
  assert.match(src, /withLogins = false/);
  // Write-back is opt-in too: only the session Tarik signs in through should
  // be able to rewrite the shared profile.
  assert.match(src, /persist = false/);
  // A context may only be attached behind that flag.
  assert.match(src, /useContext = withLogins && !!contextId/);
  assert.ok(
    !/browserSettings:\s*\{\s*context/.test(src.replace(/useContext[\s\S]*?:\s*\{\}/, "")),
    "context must not be attached outside the opt-in branch",
  );
});

test("the agent only gets logins when the request explicitly says so", () => {
  const src = readFileSync(
    new URL("../src/app/api/tools/[tool]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /body\.use_my_logins === true/);
  assert.ok(
    !/createBrowserSession\(\{\s*withLogins:\s*true\s*\}\)/.test(src),
    "the tool route must never hardcode withLogins: true",
  );
});

test("no scheduled path can reach the browser", () => {
  // The whole safety story rests on browsing being attended. A cron that could
  // browse as Tarik while he sleeps is the failure this test exists to catch.
  for (const file of ["../convex/crons.ts", "../convex/workflowRunner.ts"]) {
    let src: string;
    try {
      src = readFileSync(new URL(file, import.meta.url), "utf8");
    } catch {
      continue; // file may not exist; nothing to guard
    }
    assert.ok(
      !/api\/browser\/|createBrowserSession|"browse"/.test(src),
      `${file} must not start a browser session`,
    );
  }
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
