import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* /talk (MOO-527). The plan shipped this route as chrome only and deferred
 * wiring to a "Task 4b", flagging that a page might not be able to reach the
 * session at all. It can — but only after the provider moves.
 *
 * Verified in node_modules/@elevenlabs/react before writing any of it:
 *   - useConversationStatus/Mode/Controls read from ConversationContext and
 *     work anywhere inside ConversationProvider.
 *   - registerCallbacks is a listener MAP (additive), and useConversation()
 *     with no args registers zero keys — so a second consumer cannot clobber
 *     VoiceDock's onMessage. That was the risk worth checking.
 *   - startSession early-returns if a session exists, so no double sessions. */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const page = read("../src/app/talk/page.tsx");
const shell = read("../src/components/AppShell.tsx");
const transcripts = read("../convex/transcripts.ts");

/* Scoped to AppShellInner: AppShell's signed-out early return also renders
 * {children}, and matching that one instead made this assert on the wrong
 * branch entirely. */
const inner = shell.slice(shell.indexOf("function AppShellInner"));

test("the provider wraps the pages, not just the dock", () => {
  const open = inner.indexOf("<ConversationProvider>");
  const children = inner.indexOf("{children}");
  const close = inner.indexOf("</ConversationProvider>");
  assert.ok(open > -1 && close > -1, "AppShellInner mounts ConversationProvider");
  assert.ok(
    open < children && children < close,
    "a page cannot read the session unless it renders inside the provider",
  );
});

test("Authenticated still gates exactly the dock and viewport", () => {
  const auth = shell.indexOf("<Authenticated>");
  assert.ok(shell.indexOf("{children}") < auth, "pages stay outside Authenticated");
  const gated = shell.slice(auth, shell.indexOf("</Authenticated>"));
  assert.match(gated, /<ViewportPanel \/>/);
  assert.match(gated, /<VoiceDock \/>/);
});

/* A route with no entry point is not shipped. The spec's way in is the live
 * bar — "Tap for the full screen." */
test("the live dock is a way into /talk", () => {
  const dock = read("../src/components/VoiceDock.tsx");
  assert.match(dock, /href="\/talk"/, "the live dock links to the full screen");
});

test("Zola can navigate here by voice like any other page", () => {
  const dock = read("../src/components/VoiceDock.tsx");
  assert.match(dock, /talk: "\/talk"/, "/talk is in the navigate_ui page map");
});

test("the route shows real session state, not a placeholder", () => {
  assert.match(page, /useConversation\(\)/, "reads the live session from context");
  assert.match(page, /status === "connected"/, "derives live state from status");
  assert.ok(
    !/The running exchange appears here while a session is live/.test(page),
    "the placeholder copy must be gone — a fake transcript is worse than none",
  );
});

test("the transcript comes from Convex, so it survives a refresh", () => {
  assert.match(transcripts, /export const latest = query/, "a latest query exists");
  assert.match(page, /api\.transcripts\.latest/, "the page subscribes to it");
});

test("disengage and mute are wired to the real session", () => {
  assert.match(page, /endSession/, "disengage ends the real session");
  assert.match(page, /setMuted/, "mute toggles the real mic");
});

/* Honesty: when nothing is live, the turns on screen are the LAST session's,
 * not a running one. Labelling them "live" would be the Glow Means Live rule
 * broken in prose instead of CSS. */
test("the page never implies a session is live when it is not", () => {
  assert.match(page, /connected \?/, "copy branches on the real connection state");
  assert.match(
    page,
    /connected \? "Transcript" : "Last conversation"/,
    "an old transcript must not be labelled as a running one",
  );
  // Windowed, not line-based: the condition and the class sit on different
  // lines inside a formatted ternary.
  for (const m of page.matchAll(/hud-glow/g)) {
    assert.match(
      page.slice(Math.max(0, m.index - 160), m.index),
      /connected\s*(\?|&&)/,
      "glow must sit inside a live-state branch",
    );
  }
});

test("disengage is a filled cap in the destructive channel", () => {
  assert.match(page, /lcars-cap/, "primary action uses the cap silhouette");
  assert.match(page, /bg-salmon/, "destructive action carries the salmon channel");
});

/* DESIGN.md § The Two Voices Rule: "Antonio speaks only in caps", and § Don't:
 * no lowercase display type. Caught by looking at a render — the label read
 * "Disengage" in title case while the dock's own button says DISENGAGE. */
test("cap labels are black Antonio uppercase", () => {
  const display = [...page.matchAll(/font-\[family-name:var\(--font-display\)\][^"`]*/g)];
  assert.ok(display.length > 0, "the page uses the display font on its caps");
  for (const m of display) {
    assert.match(m[0], /text-black/, `display type on a cap must be black: ${m[0]}`);
    assert.match(m[0], /uppercase/, `Antonio speaks only in caps: ${m[0]}`);
  }
});

test("flat at rest, and every transition pairs with motion-reduce", () => {
  assert.ok(!/shadow-(sm|md|lg|xl|2xl)\b/.test(page), "no resting shadows");
  for (const line of page.split("\n")) {
    if (!/\btransition\b/.test(line)) continue;
    assert.match(
      line,
      /motion-reduce:transition-none/,
      `transition without motion-reduce: ${line.trim()}`,
    );
  }
});

test("interactive elements take the cyan focus outline", () => {
  const buttons = (page.match(/<button\b/g) ?? []).length;
  const outlines = (page.match(/focus-visible:outline-2/g) ?? []).length;
  assert.ok(buttons > 0, "the page has controls");
  assert.equal(outlines, buttons, "every control is focus-ringed");
});
