import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REFERENCE_TYPES,
  rankSources,
  sourceLabel,
  type SourceHit,
} from "../convex/studioLib.ts";

// Studio references (Phase 2): pointing a document at a record that already
// exists, without copying it.
//
// The ranking matters more than it looks. The picker searches six unrelated
// tables at once, and whatever lands first is what gets attached — so a brief
// whose title matches exactly must not sit below a contact that matched on one
// word of an email address.

const hit = (over: Partial<SourceHit>): SourceHit => ({
  type: "brief",
  sourceId: "x",
  title: "untitled",
  snippet: "",
  at: 0,
  ...over,
});

test("the types cover every record the PRD names as referenceable", () => {
  for (const type of ["brief", "conversation", "telos", "contact", "thought", "document", "url"]) {
    assert.ok(
      (REFERENCE_TYPES as readonly string[]).includes(type),
      `${type} is not a reference type`,
    );
  }
});

test("an exact title match outranks a partial one", () => {
  // Ids chosen so the final alphabetical tie-break would give the WRONG
  // answer. The first version used "exact"/"partial", which sort correctly by
  // accident — so removing the exact-match score entirely still passed.
  const ranked = rankSources(
    [
      hit({ sourceId: "aaa-partial", title: "Turnout notes from March" }),
      hit({ sourceId: "zzz-exact", title: "Turnout" }),
    ],
    "turnout",
  );
  assert.equal(ranked[0].sourceId, "zzz-exact");
});

test("a title match outranks a body match", () => {
  // Otherwise a long transcript that says the word once buries the brief
  // actually called that.
  const ranked = rankSources(
    [
      hit({ sourceId: "body", title: "Unrelated", snippet: "we discussed turnout at length" }),
      hit({ sourceId: "title", title: "Turnout in the 4th" }),
    ],
    "turnout",
  );
  assert.equal(ranked[0].sourceId, "title");
});

test("non-matches are dropped, not ranked low", () => {
  // Handing back everything invites attaching the wrong record because it
  // happened to be on screen.
  const ranked = rankSources([hit({ title: "Something else", snippet: "nothing" })], "turnout");
  assert.equal(ranked.length, 0);
});

test("every spoken word has to land somewhere", () => {
  // "Turnout brief" must not match a document called "Turnout" alone on one
  // word out of two — the same rule contact search learned the hard way.
  const ranked = rankSources(
    [hit({ sourceId: "one", title: "Turnout" }), hit({ sourceId: "both", title: "Turnout brief" })],
    "turnout brief",
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].sourceId, "both");
});

test("ties break on recency, so the newest of two equals comes first", () => {
  // Same trap as above: "new" sorts before "old" alphabetically, so the first
  // version of this passed with the recency rule deleted. The newer record is
  // given the id that loses on every other tie-break.
  const ranked = rankSources(
    [
      hit({ sourceId: "aaa-old", title: "Turnout", at: 100 }),
      hit({ sourceId: "zzz-new", title: "Turnout", at: 900 }),
    ],
    "turnout",
  );
  assert.equal(ranked[0].sourceId, "zzz-new");
});

test("ranking is stable across identical input", () => {
  // The picker re-runs on every keystroke. A list that reorders under a
  // stationary cursor is how the wrong record gets clicked.
  const rows = [
    hit({ sourceId: "a", title: "Turnout", at: 5 }),
    hit({ sourceId: "b", title: "Turnout", at: 5 }),
    hit({ sourceId: "c", title: "Turnout", at: 5 }),
  ];
  const first = rankSources(rows, "turnout").map((r) => r.sourceId);
  const second = rankSources([...rows], "turnout").map((r) => r.sourceId);
  assert.deepEqual(first, second);
});

test("an empty query returns nothing rather than everything", () => {
  // The picker opens empty. Dumping every record in six tables into it is
  // both a slow first paint and an invitation to attach something at random.
  assert.deepEqual(rankSources([hit({})], "  "), []);
});

test("search ignores case and punctuation", () => {
  const ranked = rankSources([hit({ title: "Turnout in the 4th" })], "TURNOUT, 4TH");
  assert.equal(ranked.length, 1);
});

test("a label falls back to something readable when a record has no title", () => {
  // Half the referenceable records have no title field at all — a thought and
  // a transcript are just text. A blank chip in the middle of a sentence is
  // worse than a truncated one.
  assert.equal(sourceLabel({ type: "thought", title: "" }), "Untitled thought");
  assert.equal(sourceLabel({ type: "brief", title: "  " }), "Untitled brief");
});

test("a long label is cut so a chip cannot break the line it sits in", () => {
  const label = sourceLabel({ type: "brief", title: "x".repeat(200) });
  assert.ok(label.length < 100, `label too long: ${label.length}`);
});

test("a label keeps a normal title exactly as it is", () => {
  assert.equal(sourceLabel({ type: "brief", title: "Turnout in the 4th" }), "Turnout in the 4th");
});
