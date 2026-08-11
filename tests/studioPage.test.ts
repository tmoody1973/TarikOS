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

test("the editor uses Plate's full kit, and the exception is written down", () => {
  // This REVERSES an earlier assertion in this file, deliberately. The rule
  // "no component library for visual primitives" now carries one scoped
  // exception — the Studio editor — because a hand-rolled rich-text editor is
  // permanently one feature behind, and this surface is judged against Notion
  // and Word rather than against a dashboard.
  //
  // The exception has to stay WRITTEN DOWN or a future session will read the
  // Don'ts, see shadcn imports, and "fix" it back out.
  assert.match(EDITOR, /EditorKit/, "the editor must use Plate's full plugin kit");
  assert.match(EDITOR, /@\/components\/ui\/editor/, "and Plate's own editor components");
  assert.match(DESIGN, /One scoped exception/, "DESIGN.md must record the exception");
  assert.match(DESIGN, /Studio editor/);
});

test("the exception does not leak past the editor", () => {
  // The page around the editor, the index and the history panel stay
  // hand-rolled. A shadcn import here would be the exception widening.
  assert.ok(!/@\/components\/ui\//.test(INDEX), "the index must stay hand-rolled");
  assert.ok(
    !/@\/components\/ui\//.test(DOC),
    "the document page around the editor must stay hand-rolled",
  );
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



test("the AI menu speaks to Claude, not to a gateway we have no key for", () => {
  // Plate's registry route ships pointed at the Vercel AI Gateway with Gemini
  // and GPT defaults and demands an AI_GATEWAY_API_KEY this project does not
  // have — so shipped as-is, every AI action would have failed with a 401.
  const AI = CODE("src/app/api/ai/command/route.ts");
  assert.match(AI, /claude-/);
  assert.ok(!/AI_GATEWAY_API_KEY|createGateway/.test(AI), "must not need a gateway key");
  assert.ok(!/gemini|gpt-4o/.test(AI), "must not fall back to the registry's models");
  assert.match(AI, /ANTHROPIC_API_KEY/);
});

test("the AI route is behind a session", () => {
  // It bills Tarik's key. /api/tools is exempt from Clerk because ElevenLabs
  // authenticates with a shared secret; nothing under /api/ai may join it.
  const AI = CODE("src/app/api/ai/command/route.ts");
  const PROXY = CODE("src/proxy.ts");
  assert.match(AI, /await auth\(\)/);
  assert.match(AI, /401/);
  assert.ok(!/api\/ai/.test(PROXY), "the AI route must not be public");
});

test("every token Plate's components reference is defined", () => {
  // Predicted rather than seen: shadcn components name seventeen tokens this
  // system never had. Undefined, `border-border` and `bg-popover` resolve to
  // nothing — a toolbar that is present and invisible.
  const used = new Set(
    [...readFileSync("src/components/ui/toolbar.tsx", "utf8").matchAll(
      /\b(?:bg|text|border|ring|fill)-(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring)(-foreground)?\b/g,
    )].map((m) => `${m[1]}${m[2] ?? ""}`),
  );
  assert.ok(used.size > 0, "found no tokens to check — the regex or the file moved");
  for (const token of used) {
    assert.match(
      CSS,
      new RegExp(`--color-${token}:`),
      `Plate uses ${token} and globals.css does not define it`,
    );
  }
});

test("the editor's chrome inherits LCARS rather than shadcn's greys", () => {
  // The point of defining them by hand. If these were shadcn's defaults the
  // editor would arrive with its own palette and read as a foreign object.
  assert.match(CSS, /--ring: var\(--hud-cyan\)/, "focus is cyan everywhere");
  assert.match(CSS, /--primary: var\(--lcars-ochre\)/, "primary is Studio's channel");
  assert.match(CSS, /--destructive: var\(--lcars-salmon\)/);
  assert.match(CSS, /--border: var\(--panel-edge\)/);
});
