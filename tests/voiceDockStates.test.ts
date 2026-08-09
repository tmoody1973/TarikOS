import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* DESIGN.md: the system is "quiet by default and alive by exception", and
 * "glow means live". The dock contradicted both on a phone — the same ~90px
 * bar on every page whether Zola was mid-sentence or idle for six hours.
 *
 * Source-text guards, because this project tests with node:test and has no DOM
 * renderer. Each one is mutation-tested; the states are also looked at in a
 * 375px viewport. */

const dock = readFileSync(
  new URL("../src/components/VoiceDock.tsx", import.meta.url),
  "utf8",
);

test("the idle form is a cap, not the full bar", () => {
  assert.match(dock, /lcars-cap-left/, "idle state uses the LCARS cap silhouette");
});

test("the idle cap is mobile-only", () => {
  const cap = dock.slice(dock.indexOf("lcars-cap-left"));
  assert.match(
    cap.slice(0, 400),
    /lg:hidden/,
    "the cap must not appear on desktop, which keeps the full cluster",
  );
});

/* The plan's version of this task early-returned the whole component when
 * disconnected, which would have deleted the desktop dock's idle state — and
 * the plan's own global constraint is that desktop must not change. The bar
 * has to still render above lg while idle. */
test("desktop keeps the full bar even when idle", () => {
  assert.match(
    dock,
    /connected \? "flex" : "hidden lg:flex"/,
    "the bar hides below lg when idle but stays at lg and up",
  );
  assert.ok(
    !/if \(!connected\) \{\s*return/.test(dock),
    "an early return on !connected would strip desktop of its idle dock",
  );
});

test("the waveform and tool matrix are desktop telemetry, gated above md", () => {
  const gate = dock.indexOf('className="hidden md:block"');
  assert.ok(gate > 0, "there is an md-and-up block");
  const gated = dock.slice(gate, dock.indexOf("</div>", dock.indexOf("<Matrix")));
  assert.match(gated, /<LiveWaveform/, "waveform sits inside the md gate");
  assert.match(gated, /<Matrix/, "matrix sits inside the md gate");
});

test("the transcript is no longer the thing mobile drops", () => {
  assert.ok(
    !/hidden[^"]*\bmd:block/.test(dock.slice(dock.indexOf("Latest exchange"))),
    "the last exchange must be visible on a phone — the words beat the telemetry",
  );
});

/* Promoting the transcript and then leaving it 12px of a 375px bar would be
 * the same bug wearing a new hat. Measured: orb + status + DISENGAGE consume
 * the row, so below md the words take a row of their own. */
test("the transcript gets real width on a phone, not a sliver", () => {
  const bar = dock.slice(dock.indexOf("Latest exchange"));
  assert.match(bar.slice(0, 300), /w-full/, "transcript is full-width below md");
  assert.match(bar.slice(0, 300), /order-last/, "and sits on its own row");
  assert.match(dock, /flex-wrap/, "the bar must be allowed to wrap");
});

/* Checked over a window rather than a single line: the condition and the class
 * legitimately sit on different lines inside a formatted ternary, so a
 * line-based check fails correct code. The window still fails an unconditional
 * `hud-glow` — mutation-tested. */
test("glow is never applied to something that is not live", () => {
  const occurrences = [...dock.matchAll(/hud-glow/g)];
  assert.ok(occurrences.length > 0, "the live state does glow — that's the point");
  for (const m of occurrences) {
    const before = dock.slice(Math.max(0, m.index - 160), m.index);
    assert.match(
      before,
      /connected\s*(\?|&&)/,
      `hud-glow must sit inside a live-state branch, near: ${JSON.stringify(before.slice(-80))}`,
    );
  }
});

test("every transition pairs with motion-reduce", () => {
  for (const line of dock.split("\n")) {
    if (!/\btransition\b/.test(line)) continue;
    assert.match(
      line,
      /motion-reduce:transition-none/,
      `transition without motion-reduce: ${line.trim()}`,
    );
  }
});

test("the idle cap is labelled for assistive tech", () => {
  assert.match(dock, /aria-label="Start a voice session"/);
});

/* There must be exactly one way to open a session. A second start path is how
 * the token fetch, the transcript row and the standing-context query drift
 * apart between two callers. */
test("the cap reuses engage rather than growing a second start path", () => {
  assert.equal(
    (dock.match(/conversation\.startSession\(/g) ?? []).length,
    1,
    "startSession is called from exactly one place",
  );
  assert.equal(
    (dock.match(/async function engage\(/g) ?? []).length,
    1,
    "engage is defined once",
  );
});
