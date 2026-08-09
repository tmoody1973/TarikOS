import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The rail and the spine must render from the same list. If either grows its
 * own array, a destination can exist on desktop and not on mobile — a bug you
 * only find on a phone.
 *
 * These are source-text guards because this project tests with node:test and
 * has no DOM renderer. That makes them capable of passing while the UI is
 * broken, so each one is mutation-tested and the result is also looked at on a
 * narrow viewport. A guard nobody has watched fail is theater. */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const rail = read("../src/components/NavRail.tsx");
const spine = read("../src/components/Spine.tsx");
const shell = read("../src/components/AppShell.tsx");

test("both navs import the shared destination list", () => {
  for (const [name, src] of [["NavRail", rail], ["Spine", spine]] as const) {
    assert.match(src, /from "@\/lib\/navLinks"/, `${name} must import navLinks`);
    assert.match(src, /NAV_LINKS/, `${name} must render NAV_LINKS`);
  }
});

test("neither nav declares its own destination array", () => {
  for (const [name, src] of [["NavRail", rail], ["Spine", spine]] as const) {
    assert.ok(
      !/(const|let)\s+\w*(LINKS|ROUTES|PAGES|DESTINATIONS)\w*\s*[:=]\s*\[/.test(src),
      `${name} must not declare its own destination array`,
    );
  }
});

test("the spine renders below lg and the rail above it", () => {
  assert.match(rail, /hidden[^"]*lg:flex/, "rail is desktop-only");
  assert.match(spine, /lg:hidden/, "spine is mobile-only");
});

test("the shell mounts the spine, so a phone has navigation at all", () => {
  assert.match(shell, /from "\.\/Spine"/, "AppShell must import Spine");
  assert.match(shell, /<Spine \/>/, "AppShell must render Spine");
});

/* DESIGN.md:168 § Rail active state — "Active nav/index cap runs full width at
 * full saturation; inactive caps sit narrower (~82%) and desaturated (~45%).
 * Two channels, because opacity alone at AA-legible contrast is not a visible
 * difference." The spine must carry both channels, not just one. */
test("the spine distinguishes active by width AND saturation", () => {
  assert.match(spine, /w-full/, "active segment runs full width");
  assert.match(spine, /w-\[8\d%\]/, "inactive segments sit narrower");
  assert.match(spine, /saturate-\[\.\d+\]/, "inactive segments are desaturated");
});

/* The strip started at 12px. Measured at 375px against the compiled CSS, that
 * gave a 12px tap target on a phone's primary navigation — under WCAG 2.5.8's
 * 24px minimum — and left 2.16px between the active and inactive widths, so
 * colour was carrying the state alone. 24px is the floor; w-3 must not creep
 * back for looking tidier. */
test("the strip is at least 24px wide, per WCAG 2.5.8", () => {
  const strip = spine.slice(spine.indexOf("<button"), spine.indexOf("</button>"));
  const width = strip.match(/\bw-(\d+)\b/)?.[1];
  assert.ok(width, "the strip declares a width");
  // Tailwind spacing: w-6 = 1.5rem = 24px.
  assert.ok(Number(width) * 4 >= 24, `strip is ${Number(width) * 4}px, needs >= 24px`);
});

test("main clears the strip below lg", () => {
  const pad = shell.match(/\bpl-(\d+) lg:pl-0/)?.[1];
  assert.ok(pad, "main declares mobile-only left padding");
  assert.ok(Number(pad) * 4 >= 24, `main pads ${Number(pad) * 4}px, must clear the 24px spine`);
});

test("the spine uses the one-sided cap silhouette", () => {
  assert.match(spine, /lcars-cap-/, "segments and caps are LCARS end-caps");
});

test("the spine is flat at rest", () => {
  assert.ok(!/shadow-(sm|md|lg|xl|2xl)\b/.test(spine), "no resting shadow");
  assert.ok(!/hud-glow/.test(spine), "glow means live; nav is not live data");
});

test("the sheet is reachable and dismissible by assistive tech", () => {
  assert.match(spine, /aria-label=/, "the strip control is labelled");
  assert.match(spine, /aria-expanded=/, "the strip reports open state");
  assert.match(spine, /aria-current=\{active \? "page" : undefined\}/, "active cap is marked");
});

test("every transition pairs with motion-reduce", () => {
  for (const line of spine.split("\n")) {
    if (!/\btransition\b/.test(line)) continue;
    assert.match(
      line,
      /motion-reduce:transition-none/,
      `transition without motion-reduce: ${line.trim()}`,
    );
  }
});

test("interactive elements take the cyan focus outline", () => {
  const focusables = (spine.match(/<(button|Link)\b/g) ?? []).length;
  const outlines = (spine.match(/focus-visible:outline-2/g) ?? []).length;
  assert.ok(focusables > 0, "the spine has interactive elements");
  assert.equal(outlines, focusables, "every interactive element is focus-ringed");
});
