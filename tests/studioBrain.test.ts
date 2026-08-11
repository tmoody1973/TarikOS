import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REFERENCE_TYPES,
  blocksMatching,
  documentFrom,
  parseValue,
  plainText,
  rankSources,
  replaceBlockText,
  studioHit,
  type StudioValue,
} from "../convex/studioLib.ts";

// Ending Studio's isolation: the picker, the brain, and the voice tools all
// need the same two things from a stored document — a rankable hit, and a way
// to address ONE block of it by the words in it.
//
// Voice has no cursor. The only handle Zola has on a paragraph is a quote from
// it, so the quote has to resolve exactly the way a contact name does: to one
// thing, or to a question.

const doc = (over: Partial<Parameters<typeof studioHit>[0]> = {}) => ({
  _id: "doc-1",
  title: "Turnout in the 4th",
  content: JSON.stringify([
    { type: "h1", children: [{ text: "Turnout in the 4th" }] },
    { type: "p", children: [{ text: "Ward turnout fell nine points." }] },
  ]),
  updatedAt: 10,
  ...over,
});

// ------------------------------------------------------------ the picker

test("studio is a thing a document can point at", () => {
  assert.ok(
    (REFERENCE_TYPES as readonly string[]).includes("studio"),
    "a Studio document cannot cite another Studio document",
  );
});

test("a studio hit carries the document's own id", () => {
  assert.equal(studioHit(doc()).sourceId, "doc-1");
  assert.equal(studioHit(doc()).type, "studio");
});

test("a studio hit's snippet is the writing, never the JSON tree", () => {
  const snippet = studioHit(doc()).snippet;
  assert.ok(
    snippet.includes("Ward turnout fell nine points"),
    "the body did not reach the snippet",
  );
  // The stored form is a Slate tree. Searching for the word "children" must not
  // match every document ever written.
  assert.ok(!snippet.includes("children"), "the raw tree leaked into the snippet");
});

test("a studio document is found by words in its body, not only its title", () => {
  // The rule that makes recall worth having: the paragraph is the reason to
  // find the document, and the title rarely repeats it.
  const ranked = rankSources([studioHit(doc())], "nine points");
  assert.equal(ranked.length, 1);
});

// -------------------------------------------------- addressing one block

const value: StudioValue = [
  { type: "h1", children: [{ text: "The plan" }] },
  { type: "p", children: [{ text: "Turnout fell nine points in the fourth." }] },
  { type: "p", children: [{ text: "Funding is unchanged." }] },
];

test("a quote resolves to the one block containing it", () => {
  const found = blocksMatching(value, "turnout");
  assert.equal(found.length, 1);
  assert.equal(found[0].index, 1);
  assert.equal(found[0].text, "Turnout fell nine points in the fourth.");
});

test("a quote in two blocks resolves to both, so she can ask which", () => {
  // She never picks. Two candidates is a question, exactly like find_contact.
  const found = blocksMatching(
    [
      { type: "p", children: [{ text: "Turnout fell." }] },
      { type: "p", children: [{ text: "Turnout recovered." }] },
    ],
    "turnout",
  );
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((f) => f.index),
    [0, 1],
  );
});

test("a quote matches across punctuation and case the speaker cannot hear", () => {
  // Spoken words arrive without the em-dash and without the capital.
  const found = blocksMatching(
    [{ type: "p", children: [{ text: "Turnout — nine points — fell." }] }],
    "nine points",
  );
  assert.equal(found.length, 1);
});

test("a quote matching nothing resolves to nothing", () => {
  assert.equal(blocksMatching(value, "budget").length, 0);
});

test("an empty quote matches no block rather than every block", () => {
  // Otherwise a dropped word in transcription silently addresses the whole
  // document, and the first paragraph gets rewritten.
  assert.equal(blocksMatching(value, "   ").length, 0);
});

test("blocks are matched by their own words, not their children's markup", () => {
  const bolded: StudioValue = [
    { type: "p", children: [{ text: "Turnout " }, { text: "fell", bold: true }] },
  ];
  assert.equal(blocksMatching(bolded, "turnout fell").length, 1);
});

// ----------------------------------------------------- applying a change

test("replacing a block changes that block and no other", () => {
  const next = replaceBlockText(value, 1, "Turnout fell nine points.");
  assert.equal(next[1].children?.[0] && "text" in next[1].children[0] ? next[1].children[0].text : "", "Turnout fell nine points.");
  assert.deepEqual(next[0], value[0]);
  assert.deepEqual(next[2], value[2]);
});

test("replacing a block keeps the block's type", () => {
  // A rewritten heading must not come back as a paragraph.
  const next = replaceBlockText(value, 0, "The revised plan");
  assert.equal(next[0].type, "h1");
});

test("replacing a block does not mutate the value it was given", () => {
  const before = JSON.stringify(value);
  replaceBlockText(value, 1, "something else");
  assert.equal(JSON.stringify(value), before);
});

test("replacing an index that is not there returns the document unchanged", () => {
  assert.deepEqual(replaceBlockText(value, 9, "nope"), value);
});

// -------------------------------------------------- writing by dictation

test("a dictated document starts from its type's template", () => {
  // A brief dictated over the phone should still BE a brief when he opens it —
  // Summary, Context, Findings, Recommendation, Next steps.
  const text = plainText(documentFrom("brief", "Turnout", ""));
  assert.match(text, /Summary/);
  assert.match(text, /Recommendation/);
});

test("a dictated title lands where the document's title is read from", () => {
  const value = documentFrom("brief", "Turnout in the 4th", "");
  assert.equal(plainText(value).split("\n")[0], "Turnout in the 4th");
});

test("dictated words arrive as paragraphs at the end, not as one run-on line", () => {
  const value = documentFrom("note", "", "First thought.\nSecond thought.");
  const text = plainText(value);
  assert.match(text, /First thought\./);
  assert.match(text, /Second thought\./);
  assert.notEqual(
    text.indexOf("First thought."),
    text.indexOf("Second thought."),
    "both lines collapsed into one block",
  );
});

test("dictating nothing leaves the template alone", () => {
  // Otherwise every dictated document opens with a stray empty paragraph.
  assert.deepEqual(documentFrom("note", "", ""), documentFrom("note", "", "   "));
});

// ------------------------------------------------------------- parsing

test("a stored document parses back to its blocks", () => {
  assert.equal(parseValue(JSON.stringify(value)).length, 3);
});

test("content that is not a document parses to an empty one rather than throwing", () => {
  // This runs over content from a database and, on the voice path, from a
  // model. A malformed tree must not throw during a page render.
  assert.deepEqual(parseValue("{not json"), []);
  assert.deepEqual(parseValue('{"not":"an array"}'), []);
});
