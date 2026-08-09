import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* MOO-532's "no horizontal scroll at 320 / 375 / 414" applies to compose too.
 *
 * The reader already defends itself — `.reader-prose` caps img width, gives
 * tables their own overflow, and wraps long unbroken strings. The compose
 * editor had NO such rules at all, and it renders arbitrary HTML: a reply
 * prefilled from a Gmail-authored draft, or anything pasted out of a
 * newsletter. A single wide image pushes the whole phone sideways.
 *
 * Both class names are covered: `.tiptap` is the wrapper TipTap sets, and
 * `.ProseMirror` is the one prosemirror-view puts on the editable node. */

const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

/* Only rules whose selector actually names the editor. Slicing from the
 * comment to end-of-file instead swept in `.reader-prose table { overflow-x:
 * auto }`, which sits below it — so removing the editor's own table rule left
 * the test passing. Caught by mutation, not by reading. */
const editorRules = [...css.matchAll(/([^{}]*\.(?:tiptap|ProseMirror)[^{}]*)\{([^}]*)\}/g)]
  .map((m) => `${m[1].trim()}{${m[2].trim()}}`)
  .join("\n");

test("the compose editor constrains what it renders", () => {
  assert.ok(editorRules.length > 0, "the editor has its own rules at all");
});

test("images cannot exceed the column", () => {
  assert.match(editorRules, /img\s*\{[^}]*max-width:\s*100%/);
});

test("wide tables scroll inside themselves, not the page", () => {
  assert.match(editorRules, /table\s*\{[^}]*overflow-x:\s*auto/);
});

test("a long unbroken string wraps instead of stretching the column", () => {
  assert.match(editorRules, /overflow-wrap:\s*anywhere/);
});

test("both TipTap class names are covered", () => {
  assert.match(editorRules, /\.tiptap/, "the wrapper class");
  assert.match(editorRules, /\.ProseMirror/, "the editable node class");
});
