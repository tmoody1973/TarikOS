import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Long unbroken strings are the one thing that actually breaks these pages on
 * a phone — not layout. Measured at 375px: a real-shaped tool error
 * (`{"error":"invalid_grant","request_id":"a1b2…"}`) pushed the WHOLE PAGE
 * sideways by 133px on /control. Not a panel, the page.
 *
 * The surfaces at risk are the ones rendering text the app did not author:
 * API error strings, stored memories, journal entries. `/telos` and `/briefs`
 * already use [overflow-wrap:anywhere] for exactly this; these are the ones
 * that were missed.
 *
 * Guard by rendering site rather than by counting: a new unprotected error
 * line is the regression worth catching. */

const read = (p: string) =>
  readFileSync(new URL(p, import.meta.url), "utf8");

/* A lookback window, not "the nearest `<`". The first version took
 * lastIndexOf("<") to find the enclosing tag, which for
 * `<span>[{m.type}]</span>{" "}{m.content}` lands on the CLOSING span and
 * never sees the button's className — failing correct code. JSX nests too
 * freely for that heuristic; the window is honest about being approximate,
 * and mutation-testing confirms it still catches a removed class. */
function context(src: string, needle: string, back = 500): string {
  const i = src.indexOf(needle);
  assert.ok(i > -1, `expected to find ${needle}`);
  return src.slice(Math.max(0, i - back), i);
}

test("tool errors on /control wrap instead of widening the page", () => {
  const control = read("../src/app/control/page.tsx");
  for (const needle of ["{tool.lastError}", "{wf.lastError}"]) {
    assert.match(
      context(control, needle),
      /\[overflow-wrap:anywhere\]/,
      `${needle} renders an API error string and must wrap`,
    );
  }
});

/* The /brain lists became one stream on 2026-08-21, so the rendering sites
 * moved out of the page and into BrainStream. The risk did not move: every one
 * of these renders text the app did not author — a memory Zola wrote, a
 * decision's rationale, a journal entry, a node label. */
test("stored memories and journal entries on /brain wrap", () => {
  const stream = read("../src/components/BrainStream.tsx");
  for (const needle of ["{item.text}", "{item.why}"]) {
    assert.match(
      context(stream, needle),
      /\[overflow-wrap:anywhere\]/,
      `${needle} renders text the app did not author and must wrap`,
    );
  }
});

test("graph node detail wraps too", () => {
  const graph = read("../src/components/BrainGraph.tsx");
  assert.match(
    context(graph, "{node.label}"),
    /\[overflow-wrap:anywhere\]/,
    "the node inspector renders a stored label and must wrap",
  );
});

/* /telos already had this before today — asserted so the pattern cannot be
 * removed from the page that was already doing it right. */
test("/telos keeps the wrapping it already had", () => {
  assert.match(read("../src/app/telos/page.tsx"), /\[overflow-wrap:anywhere\]/);
});
