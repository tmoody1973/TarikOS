import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The /studio surfaces against DESIGN.md and the save rules.
//
// Source-scanned rather than rendered, the same way contactsPage and
// documentsPage are: these are contracts about the markup and the save loop,
// and their failures — a page with no channel colour, an autosave that retries
// a refused write — are invisible in a unit test of the logic.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const INDEX = CODE("src/app/studio/page.tsx");
const DOC = CODE("src/app/studio/[documentId]/page.tsx");
const EDITOR = CODE("src/app/studio/[documentId]/StudioEditor.tsx");
const NAV = readFileSync("src/lib/navLinks.ts", "utf8");
const DESIGN = readFileSync("DESIGN.md", "utf8");
const CSS = readFileSync("src/app/globals.css", "utf8");

test("Studio claims its own channel colour, declared everywhere it has to be", () => {
  // The Channel Color Rule: a new surface claims a hue BEFORE shipping, and a
  // hue that exists in a class name but not in the token set is a silent
  // no-op that renders as transparent.
  assert.match(CSS, /--lcars-ochre:/, "the token must exist");
  assert.match(CSS, /--color-ochre: var\(--lcars-ochre\)/, "and be exposed to Tailwind");
  assert.match(DESIGN, /LCARS Ochre/, "and be documented");
  assert.match(NAV, /href: "\/studio", color: "bg-ochre"/);
  assert.match(INDEX, /bg-ochre/);
});

test("the nav entry points at a page that exists", () => {
  // One destination list drives the desktop rail and the mobile spine, so a
  // cap with no route is a dead end on both.
  assert.match(NAV, /label: "STUDIO"/);
  assert.ok(INDEX.length > 0, "/studio/page.tsx missing");
});

test("a refused save stops the loop instead of retrying", () => {
  // The rule the whole feature rests on. A retry carries the same outdated
  // document, and if one ever wins it deletes whatever replaced it.
  // Three separate facts, none of them satisfiable by the word "blocked"
  // appearing somewhere. The first version of this test ended in
  // `|| /blocked/.test(EDITOR)`, which passed on any file containing it.
  assert.match(EDITOR, /blocked\.current = true/, "a refusal must set the flag");
  assert.match(
    EDITOR,
    /if \(content === null \|\| blocked\.current\) return/,
    "flush must refuse to run once blocked",
  );
  assert.match(
    EDITOR,
    /if \(blocked\.current\) return/,
    "and no further edit may schedule another save",
  );
});

test("a refused save is told to the writer, not swallowed", () => {
  // Their text is still on screen and still unsaved. Silence here means they
  // keep typing into something that will never persist.
  assert.match(EDITOR, /role="alert"/);
  assert.match(EDITOR, /changed somewhere else/i);
});

test("every save carries the revision it was written from", () => {
  assert.match(EDITOR, /save\(content, revision\.current\)/);
  assert.match(EDITOR, /revision\.current = result\.revision/, "and adopts the accepted one");
});

test("the revision is held in a ref, not in state", () => {
  // The autosave timer closes over it. A stale closure here would send an old
  // revision on every save and block the editor permanently after the first.
  assert.match(EDITOR, /const revision = useRef\(initialRevision\)/);
});

test("a pending edit survives the tab closing", () => {
  // Typing and closing inside the debounce window would otherwise lose the
  // last thing written — the exact failure the counter exists to prevent,
  // arriving through a different door.
  // Matched on the REGISTRATION, not the word. Both event names also appear in
  // the cleanup's removeEventListener, so a bare /pagehide/ passed with the
  // listener never added.
  assert.match(EDITOR, /addEventListener\("pagehide"/);
  assert.match(EDITOR, /addEventListener\("visibilitychange"/);
  assert.match(EDITOR, /if \(pending\.current !== null\) void flush\(\)/);
});

test("the editor is styled by hand, not imported from a component library", () => {
  // DESIGN.md: no component library for visual primitives. Plate ships a
  // shadcn registry; the elements here are ours.
  assert.ok(!/@\/components\/ui\/editor/.test(EDITOR), "must not import the shadcn editor");
  assert.match(EDITOR, /var\(--font-display\)/, "headings use the display face");
});

test("restore asks before it replaces what is on screen", () => {
  assert.match(DOC, /confirming/);
  assert.match(DOC, /Replace/);
});

test("history yields to the document below lg rather than reflowing beside it", () => {
  // A split pane at 375px gives two unusable halves — the same rule /mail and
  // /contacts follow.
  assert.match(DOC, /lg:flex-row/);
  assert.match(DOC, /lg:w-80/);
});

test("the save indicator glows only when it is a live reading", () => {
  // Glow Means Live. A permanently glowing label is a defect by the design
  // system's own rule.
  const glow = EDITOR.slice(EDITOR.indexOf("hud-glow") - 120, EDITOR.indexOf("hud-glow") + 40);
  assert.match(glow, /saved/, "the glow must be conditional on a fresh save");
});

test("an untitled document is still findable in the index", () => {
  // Sorted lists of blank rows are the failure mode of every notes app that
  // derives titles.
  assert.match(INDEX, /Untitled/);
});

test("every editor control has a visible way to reach it", () => {
  // Found by Tarik: Ask Zola was wired into the save bar's props and never
  // rendered as a button, so the only way in was a shortcut that was not
  // deployed. A keyboard-only affordance is an undiscoverable one.
  assert.match(EDITOR, /function Toolbar\(/, "the editor needs a toolbar");
  assert.match(EDITOR, /<Toolbar editor=\{editor\} onAsk=\{openAsk\}/);
  assert.match(EDITOR, /Ask Zola/, "the AI panel needs a button, not only ⌘J");
  for (const control of ["bold", "italic", "h1", "h2", "blockquote"]) {
    assert.ok(EDITOR.includes(`"${control}"`), `no visible control for ${control}`);
  }
});

test("a formatting button does not steal the selection it acts on", () => {
  // onClick moves focus out of the editor before the handler runs, collapsing
  // the selection — so bolding selected text would bold nothing.
  const tb = EDITOR.slice(EDITOR.indexOf("function TB("));
  assert.match(tb, /onMouseDown/);
  assert.match(tb, /preventDefault\(\)/);
  assert.ok(!/onClick=\{\(e\)/.test(tb), "must not use onClick for a selection action");
});
