# Mobile Shell + PWA Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TarikOS a usable phone shell — navigation that exists below `lg`, a voice dock that is quiet when idle, a full talk screen, and an installable PWA.

**Architecture:** The desktop rail's destination list is extracted to one shared module, then rendered two ways: the existing `NavRail` above `lg`, and a new 12px edge `Spine` below it. `VoiceDock` gains three states on mobile (idle cap / live bar / talk) instead of one fixed bar. PWA is Next 16's `app/manifest.ts` metadata route plus a shell-only service worker.

**Tech Stack:** Next.js 16.3.0 (App Router), React 19, Tailwind CSS 4, `node --test` for unit tests, `@elevenlabs/react` for the already-hoisted voice session.

## Global Constraints

- **The Two Voices Rule** — Antonio (`var(--font-display)`) in caps, on caps and headings only. Geist Mono everywhere else. No third typeface.
- **The One-Sided Pill Rule** — `lcars-cap-left` / `lcars-cap-right` (`9999px 0 0 9999px`) is the signature silhouette. No sharp-cornered interactive elements.
- **The Flat-At-Rest Rule** — no resting shadows. Depth from tone plus the 1px `border-panel-edge`. Only the overlay layer may use `shadow-2xl`.
- **The Glow Means Live Rule** — `hud-glow` only on data live right now. Glowing static content is a defect.
- **The Channel Color Rule** — amber HOME, lavender BRIEFS/MAIL, blue BRAIN, cyan TELOS/VIEW, sage HABITS, salmon COMMS, steel CTRL.
- Every interactive element carries `focus-visible:outline-2 outline-cyan-hud`.
- Every transition pairs with `motion-reduce:transition-none`.
- Text on colored caps is black Antonio uppercase: `font-[family-name:var(--font-display)] text-black`.
- Desktop (`lg` and up) behaviour must not change in any task.
- Tests run with `npm test` (`node --test "tests/*.test.ts"`). Imports **from `tests/`** carry the `.ts` extension.

---

### Task 1: Extract the shared destination list

Today `NavRail` owns the link list inline. The spine needs the same list; two copies will drift.

**Files:**
- Create: `src/lib/navLinks.ts`
- Modify: `src/components/NavRail.tsx:6-15` (remove the inline `LINKS`), `:49-50` (use `isActiveRoute`)
- Test: `tests/navLinks.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type NavLink = { label: string; href: string; color: string }`
  - `NAV_LINKS: readonly NavLink[]` — 8 entries, desktop rail order
  - `isActiveRoute(pathname: string, href: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/navLinks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_LINKS, isActiveRoute } from "../src/lib/navLinks.ts";

test("every destination has a label, href and channel colour", () => {
  assert.equal(NAV_LINKS.length, 8);
  for (const l of NAV_LINKS) {
    assert.ok(l.label.length > 0, "label");
    assert.ok(l.href.startsWith("/"), `href: ${l.href}`);
    assert.match(l.color, /^bg-/, `colour: ${l.color}`);
  }
});

test("HOME is active only on exactly /", () => {
  assert.equal(isActiveRoute("/", "/"), true);
  assert.equal(isActiveRoute("/briefs", "/"), false);
});

test("a section is active on its own subtree", () => {
  assert.equal(isActiveRoute("/briefs", "/briefs"), true);
  assert.equal(isActiveRoute("/briefs/2026-08-09", "/briefs"), true);
  assert.equal(isActiveRoute("/mail", "/briefs"), false);
});

test("destinations are unique — a duplicate href would light two caps", () => {
  const hrefs = NAV_LINKS.map((l) => l.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL — `Cannot find module '../src/lib/navLinks.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/navLinks.ts
/* One destination list. The desktop rail (NavRail) and the mobile spine both
 * render from here — two copies would drift, and a drifted nav is a page you
 * can reach from one device and not the other. tests/navLinks.test.ts and the
 * tripwire in tests/navShared.test.ts both guard this. */

export type NavLink = { label: string; href: string; color: string };

export const NAV_LINKS: readonly NavLink[] = [
  { label: "HOME", href: "/", color: "bg-amber" },
  { label: "BRIEFS", href: "/briefs", color: "bg-lavender" },
  { label: "BRAIN", href: "/brain", color: "bg-hudblue" },
  { label: "TELOS", href: "/telos", color: "bg-cyan-hud" },
  { label: "HABITS", href: "/habits", color: "bg-sage" },
  { label: "MAIL", href: "/mail", color: "bg-lavender" },
  { label: "COMMS", href: "/conversations", color: "bg-salmon" },
  { label: "CTRL", href: "/control", color: "bg-steel" },
] as const;

/** HOME matches only the exact root; every other section owns its subtree. */
export function isActiveRoute(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS, `fail 0`

- [ ] **Step 5: Rewire NavRail to the shared list**

In `src/components/NavRail.tsx`, delete the inline `const LINKS = [...]` block (lines 6–15) and replace the imports and the active check:

```tsx
import { NAV_LINKS, isActiveRoute } from "@/lib/navLinks";
```

Then inside the map, replace:

```tsx
const active =
  l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
```

with:

```tsx
const active = isActiveRoute(pathname, l.href);
```

and change `{LINKS.map((l) => {` to `{NAV_LINKS.map((l) => {`.

- [ ] **Step 6: Verify desktop is unchanged**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tests pass, no type errors, build clean. Load the app at desktop width and confirm all eight caps render and the active one is full-opacity.

- [ ] **Step 7: Commit**

```bash
git add src/lib/navLinks.ts src/components/NavRail.tsx tests/navLinks.test.ts
git commit -m "refactor(nav): one destination list shared by rail and spine

NavRail owned the link list inline. The mobile spine needs the same list and
two copies would drift, so it moves to src/lib/navLinks.ts with the
active-route rule extracted alongside it. No behaviour change on desktop."
```

---

### Task 2: The mobile spine

**Files:**
- Create: `src/components/Spine.tsx`
- Modify: `src/components/AppShell.tsx:30` (render `<Spine />` beside `<NavRail />`)
- Test: `tests/navShared.test.ts`

**Interfaces:**
- Consumes: `NAV_LINKS`, `isActiveRoute` from `src/lib/navLinks.ts`
- Produces: `<Spine />` — renders below `lg` only; self-contained state

- [ ] **Step 1: Write the failing tripwire**

```ts
// tests/navShared.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The rail and the spine must render from the same list. If either grows its
 * own array, a destination can exist on desktop and not on mobile — a bug you
 * only find on a phone. Mutation-tested: inlining a list in either file fails
 * this. */

const read = (p: string) =>
  readFileSync(new URL(p, import.meta.url), "utf8");

const rail = read("../src/components/NavRail.tsx");
const spine = read("../src/components/Spine.tsx");

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL — `ENOENT ... Spine.tsx`

- [ ] **Step 3: Write the Spine**

```tsx
// src/components/Spine.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_LINKS, isActiveRoute } from "@/lib/navLinks";

/* Mobile navigation. The desktop rail is hidden below lg, which left phones
 * with no navigation at all. This is the same rail collapsed to a 12px edge
 * strip: tap it and the same caps slide out, in the same order.
 *
 * Active state follows DESIGN.md § Rail active state — full width AND full
 * saturation, because opacity alone is not a visible difference at
 * AA-legible contrast. */
export function Spine() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="fixed inset-y-0 left-0 z-30 flex w-3 flex-col gap-[3px] py-2 focus-visible:outline-2 focus-visible:outline-cyan-hud"
      >
        {NAV_LINKS.map((l) => {
          const active = isActiveRoute(pathname, l.href);
          return (
            <span
              key={l.href}
              className={`lcars-cap-right block flex-1 ${l.color} ${
                active ? "w-full" : "w-[82%] saturate-[.45]"
              }`}
            />
          );
        })}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={() => setOpen(false)}
        >
          <nav
            aria-label="Sections"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-40 flex-col gap-2 border-r border-panel-edge bg-panel p-2"
          >
            {NAV_LINKS.map((l) => {
              const active = isActiveRoute(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`lcars-cap-right flex h-12 items-center p-3 transition ${l.color} ${
                    active ? "w-full" : "w-[82%] saturate-[.45]"
                  } motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud`}
                >
                  <span className="font-[family-name:var(--font-display)] text-sm text-black">
                    {l.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount it in AppShell**

In `src/components/AppShell.tsx`, add the import and render it next to the rail:

```tsx
import { Spine } from "./Spine";
```

```tsx
      <div className="flex flex-1 gap-3 p-3 pb-28">
        <NavRail />
        <Spine />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
```

Then give `main` room for the spine below `lg` by changing its className to:

```tsx
<main className="flex min-w-0 flex-1 flex-col pl-4 lg:pl-0">{children}</main>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS, `fail 0`

- [ ] **Step 6: Mutation-test the tripwire**

A guard nobody has watched fail is theater. Verify it catches a drifted list:

```bash
cp src/components/Spine.tsx /tmp/spine.bak
perl -0pi -e 's/import \{ NAV_LINKS, isActiveRoute \} from "\@\/lib\/navLinks";/const NAV_LINKS = [{ label: "HOME", href: "\/", color: "bg-amber" }];\nimport { isActiveRoute } from "\@\/lib\/navLinks";/' src/components/Spine.tsx
npm test 2>&1 | grep -E "^ℹ (pass|fail)"   # MUST show fail 1 or more
cp /tmp/spine.bak src/components/Spine.tsx && rm /tmp/spine.bak
npm test 2>&1 | grep -E "^ℹ (pass|fail)"   # back to fail 0
```

Expected: the mutated version fails; the restored version passes. If the mutation passes, the tripwire is theater — fix the test before continuing.

- [ ] **Step 7: Verify on a real narrow viewport**

Run `npm run dev`, open at 375px width. Confirm: the spine renders as a colored strip on the left edge, the active section's segment is full-width and full-saturation while the others are narrower and desaturated, tapping opens the sheet, tapping a cap navigates and closes, tapping the scrim closes. Confirm at `lg` width the spine is gone and the rail is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/components/Spine.tsx src/components/AppShell.tsx tests/navShared.test.ts
git commit -m "feat(nav): mobile edge spine — a phone can reach every page

NavRail is hidden lg:flex, so below lg there was no navigation at all. The
spine is the same rail collapsed to a 12px edge strip that expands to the same
caps in the same order.

Active state is full width AND full saturation per DESIGN.md § Rail active
state — opacity alone is not a visible difference at AA-legible contrast.

Tripwire asserts both navs render from src/lib/navLinks.ts and neither declares
its own array; mutation-tested by inlining a list in Spine and watching it fail."
```

---

### Task 3: The voice dock's three states

`VoiceDock` renders the same ~90px bar at every width whether a session is live or has been idle for hours. `DESIGN.md` says the system is "quiet by default and alive by exception."

**Files:**
- Modify: `src/components/VoiceDock.tsx:192` (the outer container), `:209-248` (status column), `:251` (transcript visibility)
- Test: `tests/voiceDockStates.test.ts`

**Interfaces:**
- Consumes: existing `connected` and `isSpeaking` booleans already computed in `VoiceDock`
- Produces: no new exports — behaviour change only

- [ ] **Step 1: Write the failing tripwire**

```ts
// tests/voiceDockStates.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* DESIGN.md: "quiet by default and alive by exception", "glow means live".
 * The dock must not wear its live dress when nothing is live, and mobile must
 * keep the words rather than the telemetry. */

const dock = readFileSync(
  new URL("../src/components/VoiceDock.tsx", import.meta.url),
  "utf8",
);

test("the idle form is a cap, not the full bar", () => {
  assert.match(dock, /lcars-cap-left/, "idle state uses the LCARS cap silhouette");
});

test("the waveform and tool matrix are desktop-only", () => {
  const waveform = dock.slice(dock.indexOf("<LiveWaveform"));
  assert.match(
    dock,
    /(hidden[^"]*md:block|md:flex)[^]*<LiveWaveform|<LiveWaveform[^]*hidden/,
    "waveform must be gated above md",
  );
  assert.ok(waveform.length > 0, "waveform still exists for desktop");
});

test("the transcript is no longer hidden on mobile", () => {
  assert.ok(
    !/hidden min-w-0 flex-1 md:block/.test(dock),
    "the last exchange must not be the thing mobile drops",
  );
});

test("glow is not applied unconditionally", () => {
  const glowLines = dock
    .split("\n")
    .filter((l) => l.includes("hud-glow"));
  for (const line of glowLines) {
    assert.ok(
      /connected|isSpeaking|\?/.test(line),
      `hud-glow must be conditional on live state: ${line.trim()}`,
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL — the idle cap doesn't exist and the transcript is still `hidden ... md:block`

- [ ] **Step 3: Implement the idle state**

Replace the outer return in `src/components/VoiceDock.tsx` (line 192) so that below `lg`, an idle session renders only a cap. Insert immediately before the existing `return (`:

```tsx
  // Quiet by default: below lg an idle dock is a single steel cap, not a bar.
  // An instrument with no reading does not get to hold the bottom of the
  // screen on every page. Desktop keeps the full cluster.
  if (!connected) {
    return (
      <div className="fixed inset-x-3 bottom-3 z-40 lg:left-[11.5rem]">
        <button
          type="button"
          onClick={engage}
          aria-label="Start a voice session"
          className="lcars-cap-left ml-auto flex h-7 w-20 items-center justify-center bg-steel transition hover:opacity-80 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud lg:hidden"
        >
          <span className="font-[family-name:var(--font-display)] text-sm text-black">
            ZOLA
          </span>
        </button>
        <div className="hidden lg:block">{/* desktop bar renders below */}</div>
      </div>
    );
  }
```

> `engage` is the existing session-start callback in this component — it is the handler already wired to the dock's start control at `VoiceDock.tsx:279` (`onClick={connected ? () => conversation.endSession() : engage}`). Reuse it; do not add a second start path.

- [ ] **Step 4: Gate the telemetry and free the transcript**

In the status column (lines 209–248), wrap the `LiveWaveform` and `Matrix` so they only render above `md`. Change the wrapper `<div className="flex w-44 shrink-0 flex-col gap-1.5">` to:

```tsx
        <div className="flex shrink-0 flex-col gap-1.5 md:w-44">
```

then wrap the waveform and matrix together:

```tsx
          <div className="hidden md:block">
            <div className="h-5">
              {connected && (
                <LiveWaveform
                  active
                  mode="scrolling"
                  barColor="#ff9900"
                  barWidth={2}
                  barGap={2}
                  height={20}
                  fadeEdges
                  className="h-5 w-full"
                />
              )}
            </div>
            <Matrix
              rows={3}
              cols={MATRIX_COLS}
              mode="vu"
              levels={matrixLevels}
              size={3}
              gap={2}
              palette={{ on: "#35e0ff", off: "#131a26" }}
              ariaLabel="Tool activity"
            />
          </div>
```

Then change the transcript container on line 251 from `hidden min-w-0 flex-1 md:block` to:

```tsx
        <div className="min-w-0 flex-1">
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS, `fail 0`

- [ ] **Step 6: Verify both states on a narrow viewport**

Run `npm run dev` at 375px. Idle: only a small steel ZOLA cap bottom-right, no bar, no glow. Start a session: the bar appears with orb, status and the last line she said — and the waveform/matrix are absent. At `lg`: unchanged, full cluster present.

- [ ] **Step 7: Commit**

```bash
git add src/components/VoiceDock.tsx tests/voiceDockStates.test.ts
git commit -m "feat(voice): the dock is quiet when nothing is live

DESIGN.md says the system is 'quiet by default and alive by exception' and
that glow means live. The dock contradicted both on a phone: the same ~90px
bar on every page whether she was mid-sentence or idle for six hours.

Below lg it now has two resting forms — a 26px steel cap when idle, the full
bar when live.

And mobile inverts what it keeps: the phone showed the waveform and tool
matrix and hid the transcript. The telemetry restates what the pulsing orb
already says; the words are what's worth the space. Waveform and matrix are
now md-and-up; the last exchange is always visible.

Desktop is untouched."
```

---

### Task 4: The `/talk` route

**Files:**
- Create: `src/app/talk/page.tsx`
- Test: `tests/talkRoute.test.ts`

**Interfaces:**
- Consumes: `NAV_LINKS` is not used here; the spine renders from `AppShell` and is already present on this route
- Produces: the `/talk` route

- [ ] **Step 1: Write the failing test**

```ts
// tests/talkRoute.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../src/app/talk/page.tsx", import.meta.url),
  "utf8",
);

test("disengage is a filled cap, per DESIGN.md § Buttons", () => {
  assert.match(page, /lcars-cap/, "primary action uses the cap silhouette");
  assert.match(page, /bg-salmon/, "destructive action carries the salmon channel");
});

test("cap labels are black Antonio uppercase", () => {
  assert.match(
    page,
    /font-\[family-name:var\(--font-display\)\][^"]*text-black/,
    "cap type is black display font",
  );
});

test("no resting shadow — flat at rest", () => {
  assert.ok(!/shadow-(sm|md|lg|xl)\b/.test(page), "no resting shadows");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL — `ENOENT ... src/app/talk/page.tsx`

- [ ] **Step 3: Write the route**

```tsx
// src/app/talk/page.tsx
"use client";

/* Full talk screen. The session itself lives in ConversationProvider above the
 * router (AppShell.tsx), so arriving here does not start a new one and leaving
 * does not end it — this is a view onto a session that already exists.
 *
 * The spine stays on screen: talk is a page, not a mode you are trapped in. */

export default function TalkPage() {
  return (
    <div className="flex min-h-[60vh] flex-col">
      <p className="pt-4 text-center text-[10px] uppercase tracking-[0.3em] text-steel">
        Voice session
      </p>
      <div className="flex flex-1 flex-col justify-end gap-2 p-4">
        <div className="rounded-lg border border-panel-edge bg-panel p-3">
          <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
            Transcript
          </span>
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">
            The running exchange appears here while a session is live.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-panel-edge px-3 text-[10px] uppercase tracking-[0.3em] text-steel transition hover:border-cyan-hud hover:text-cyan-hud motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud"
          >
            Mute
          </button>
          <button
            type="button"
            className="lcars-cap-left flex h-10 flex-1 items-center justify-center bg-salmon transition hover:opacity-80 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud"
          >
            <span className="font-[family-name:var(--font-display)] text-base text-black">
              Disengage
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
```

> Note for the implementer: this task ships the route and its chrome. Wiring the live orb, the real transcript, and the mute/disengage handlers to the existing `useConversation` state is Task 4b — raise it if the session context is not reachable from a page, because that would mean the provider needs an exported hook.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS, `fail 0`

- [ ] **Step 5: Verify the route loads**

Run `npm run dev`, visit `/talk` at 375px. Confirm the spine is present on the left edge and the disengage cap is reachable with a thumb.

- [ ] **Step 6: Commit**

```bash
git add src/app/talk/page.tsx tests/talkRoute.test.ts
git commit -m "feat(voice): /talk full screen route

A dock is not a screen. This is the full talk view — the session already lives
above the router, so this page is a view onto it rather than an owner of it.

Ships the route and its chrome; wiring the live orb and transcript to the
existing useConversation state follows."
```

---

### Task 5: Installable PWA

**Files:**
- Create: `src/app/manifest.ts`, `src/app/icon.png` (512×512), `src/app/apple-icon.png` (180×180)
- Test: `tests/manifest.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `manifest(): MetadataRoute.Manifest` — Next 16 metadata route at `/manifest.webmanifest`

- [ ] **Step 1: Write the failing test**

```ts
// tests/manifest.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import manifest from "../src/app/manifest.ts";

test("the manifest makes the app installable", () => {
  const m = manifest();
  assert.equal(m.display, "standalone", "installed app has no browser chrome");
  assert.equal(m.start_url, "/");
  assert.ok((m.name ?? "").length > 0);
  assert.ok((m.short_name ?? "").length > 0);
});

test("the splash matches the bridge, not the browser default", () => {
  const m = manifest();
  assert.equal(m.background_color, "#050608", "space black");
  assert.equal(m.theme_color, "#050608");
});

test("icons cover the sizes a home screen needs", () => {
  const sizes = (manifest().icons ?? []).map((i) => i.sizes);
  assert.ok(sizes.includes("512x512"), "512 for the splash");
  assert.ok(sizes.includes("192x192"), "192 for the home screen");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL — `Cannot find module '../src/app/manifest.ts'`

- [ ] **Step 3: Write the manifest**

```ts
// src/app/manifest.ts
import type { MetadataRoute } from "next";

/* Next 16 metadata route — serves /manifest.webmanifest.
 * Background and theme are space black (#050608) so the splash and the status
 * bar are the bridge, not a white flash. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tarik OS",
    short_name: "Tarik OS",
    description: "A personal AI operating system you talk to.",
    start_url: "/",
    display: "standalone",
    background_color: "#050608",
    theme_color: "#050608",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
```

- [ ] **Step 4: Add the icons**

Create `src/app/icon.png` at 512×512 and `src/app/apple-icon.png` at 180×180. Both on `#050608` with the amber `TARIK OS` masthead cap treatment from `NavRail` — black Antonio on amber, per the Channel Color Rule. Next serves these automatically as `<link rel="icon">` and `<link rel="apple-touch-icon">`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS, `fail 0`

- [ ] **Step 6: Verify installability on a real device**

Run `npm run build && npm start`. Open on a phone over HTTPS (or the deployed preview). Confirm the browser offers "Add to Home Screen", the icon renders, and launching it opens with no browser chrome and a black splash.

- [ ] **Step 7: Commit**

```bash
git add src/app/manifest.ts src/app/icon.png src/app/apple-icon.png tests/manifest.test.ts
git commit -m "feat(pwa): installable — manifest, icons, standalone display

Next 16 metadata route at src/app/manifest.ts. Background and theme are space
black so the splash is the bridge rather than a white flash."
```

---

### Task 6: Shell-only service worker

**Files:**
- Create: `public/sw.js`, `src/components/ServiceWorker.tsx`
- Modify: `src/components/AppShell.tsx` (render `<ServiceWorker />`), `next.config.ts` (headers for `/sw.js`)
- Test: `tests/serviceWorker.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `<ServiceWorker />` — registers `/sw.js` on mount, renders nothing

- [ ] **Step 1: Write the failing test**

```ts
// tests/serviceWorker.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Shell only. Convex is realtime and the brief, mail and calendar are live —
 * stale data on an instrument panel is worse than an honest empty state, and
 * the Glow Means Live doctrine forbids implying currency the screen does not
 * have. This guard is what stops a future edit from "helpfully" caching data. */

const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("the worker caches a shell, not data", () => {
  assert.match(sw, /caches\.open/, "uses the Cache API");
  assert.ok(
    !/\/api\//.test(sw),
    "must never cache an API route — data is live, always",
  );
  assert.ok(
    !/convex/i.test(sw),
    "must never cache Convex traffic",
  );
});

test("navigation falls back to the cached shell when offline", () => {
  assert.match(sw, /request\.mode\s*===\s*["']navigate["']/, "handles navigations");
});

test("old caches are cleaned up on activate", () => {
  assert.match(sw, /activate/, "has an activate handler");
  assert.match(sw, /caches\.delete/, "deletes superseded caches");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL — `ENOENT ... public/sw.js`

- [ ] **Step 3: Write the service worker**

```js
// public/sw.js
/* Shell-only cache. Deliberately does NOT cache data.
 *
 * Convex is realtime; the brief, mail and calendar are live. A cached brief
 * from yesterday rendered as today's is worse than an honest empty state, and
 * DESIGN.md's Glow Means Live rule forbids the screen implying currency it
 * does not have. tests/serviceWorker.test.ts fails if /api/ or convex traffic
 * is ever added here. */

const CACHE = "tarikos-shell-v1";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only navigations. Everything else — data, assets, websockets — goes to the
  // network untouched.
  if (request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(() => caches.match("/").then((r) => r ?? Response.error())),
  );
});
```

- [ ] **Step 4: Register it**

```tsx
// src/components/ServiceWorker.tsx
"use client";

import { useEffect } from "react";

/* Registers the shell cache. Renders nothing. Failure is silent by design —
 * a worker that won't install must never stop the app from loading. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
```

In `src/components/AppShell.tsx`, import it and render it inside `AppShellInner` beside `<ViewportPanel />`:

```tsx
import { ServiceWorker } from "./ServiceWorker";
```

```tsx
      <Authenticated>
        <ServiceWorker />
        <ViewportPanel />
```

- [ ] **Step 5: Add the security headers**

In `next.config.ts`, add a `headers` function to `nextConfig`:

```ts
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tests pass, no type errors, build clean.

- [ ] **Step 7: Mutation-test the no-data guard**

```bash
cp public/sw.js /tmp/sw.bak
perl -0pi -e 's|const SHELL = \["/", "/manifest.webmanifest"\];|const SHELL = ["/", "/manifest.webmanifest", "/api/tools/get_brief"];|' public/sw.js
npm test 2>&1 | grep -E "^ℹ (pass|fail)"   # MUST fail
cp /tmp/sw.bak public/sw.js && rm /tmp/sw.bak
npm test 2>&1 | grep -E "^ℹ (pass|fail)"   # back to fail 0
```

Expected: the mutated version fails. If it passes, the guard is theater — fix it before continuing.

- [ ] **Step 8: Verify offline behaviour**

Run `npm run build && npm start`. Load the app, then in DevTools set the network to Offline and reload. Expect: the shell renders immediately and the data areas show their empty/reconnecting states. **Expect no stale brief, mail, or calendar content.** If stale data appears, the worker is caching more than the shell — stop and fix.

- [ ] **Step 9: Commit**

```bash
git add public/sw.js src/components/ServiceWorker.tsx src/components/AppShell.tsx next.config.ts tests/serviceWorker.test.ts
git commit -m "feat(pwa): shell-only service worker

Caches the app shell so an installed TarikOS opens instantly, and deliberately
caches NO data. Convex is realtime; a cached brief rendered as today's is worse
than an honest empty state, and the Glow Means Live rule forbids the screen
implying currency it doesn't have.

Tripwire fails if /api/ or convex traffic is ever added to the cache list;
mutation-tested by adding an API route and watching it fail."
```

---

### Task 7: Amend `DESIGN.md`

The design system is the source of truth in this project. Shipping a change that contradicts it is how it stops being trusted.

**Files:**
- Modify: `DESIGN.md:123` (§ Layout), `DESIGN.md:135` (§ Components — add two entries)

- [ ] **Step 1: Correct § Layout**

Replace the first sentence of § Layout:

> A fixed LCARS rail (10rem wide, desktop only — hidden below `lg`) anchors the left edge

with:

> A fixed LCARS rail (10rem wide) anchors the left edge above `lg`; below it the same
> destinations render as a 12px edge spine that expands to full caps on tap

and delete the clause "Mobile collapses the rail." from the end of the section.

- [ ] **Step 2: Add the two component entries**

Under § Components, after "Navigation (LCARS Rail)":

```markdown
### Navigation (mobile spine)
- **Style:** Below `lg`, the rail collapses to a 12px left-edge strip of stacked
  `lcars-cap-right` segments in channel order. Tapping expands a 10rem sheet of full
  caps over a `black/60` scrim.
- **States:** Active segment runs full width at full saturation; inactive sit ~82% wide
  and ~45% desaturated — the same two-channel treatment as the desktop rail, because
  opacity alone is not a visible difference at AA-legible contrast.
- **Rule:** The spine and the rail render from one destination list
  (`src/lib/navLinks.ts`). Two lists would let a page exist on desktop and not on mobile.

### Voice dock (three states)
- **Idle:** Below `lg`, a single steel `lcars-cap-left` (~26px). Flat, no glow, no
  waveform, no matrix — an instrument with no reading does not hold the bottom of the
  screen.
- **Live:** A bordered panel bar: orb, status micro-label, and the last exchange. The
  cyan glow appears because a session is live — Glow Means Live, as a state rather than
  a decoration.
- **Talk:** The `/talk` route — full orb, transcript, and pushed cards inline.
- **Rule:** Mobile keeps the words, not the telemetry. The waveform and tool matrix are
  `md` and up; the last exchange is always visible.
```

- [ ] **Step 3: Verify the design sidecar**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS. The impeccable hook may note `DESIGN.md is newer than .impeccable/design.json` — refresh the sidecar if the project uses it.

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md
git commit -m "docs(design): the rail is no longer desktop-only

DESIGN.md said 'desktop only — hidden below lg' and 'Mobile collapses the
rail'. Both became false when the spine shipped. Adds the mobile spine and the
three-state voice dock as component entries.

In a project where the design system is the source of truth, shipping a change
that contradicts it is how the system stops being trusted."
```

---

## Self-review

**Spec coverage.** Spine → Task 2. Three-state dock and the telemetry inversion → Task 3. `/talk` → Task 4. Installable → Task 5. Shell-only offline → Task 6. `DESIGN.md` amendment → Task 7. The shared destination list, which the spec names as mattering, → Task 1. **Gap found and accepted:** the spec's spine "peek animation" mitigation has no task — it is a refinement that should follow real-device feedback on whether the 12px strip reads as a control, and inventing the animation before that feedback would be guessing. Raised here rather than silently dropped.

**Not in this plan, by design.** The seven-page responsive pass is Plan B. Push notifications are their own brainstorm.

**Type consistency.** `NAV_LINKS` and `isActiveRoute` are defined in Task 1 and consumed by name in Tasks 2 and 7. `NavLink` is exported but only used internally. `<Spine />`, `<ServiceWorker />` and `manifest()` are each defined once and referenced with the same names downstream.

**Known soft spot.** Task 3 Step 3 references a session-start callback named `start`; the implementer is told to check the actual name in `VoiceDock` rather than trust it. Task 4 ships `/talk` chrome without wiring live state and says so explicitly, flagging that a missing exported hook from the provider would be a real blocker worth raising rather than working around.
