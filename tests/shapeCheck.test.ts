import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeNote } from "../src/lib/shapeCheck.ts";

// Most wrong answers are strangely SHAPED first and explicably wrong second.
// Last night's bad reply_zero answer was visibly odd before anyone understood
// why: eighteen results where three to five is normal, the same sender six
// times. None of that needs intelligence — it is arithmetic, and arithmetic is
// cheap enough to run in the voice path.
//
// Ticket 11, .scratch/second-brain-v1/issues/11-she-checks-her-own-answer.md.

test("a normal-sized answer gets no note at all", () => {
  // The signal only carries meaning while it stays rare. A check that fires on
  // ordinary answers is noise she would learn to talk over.
  const note = shapeNote(["a", "b", "c", "d"], { normal: [3, 5] });
  assert.equal(note, null);
});

test("too many results names the doubt without inventing a fix", () => {
  const note = shapeNote(Array.from({ length: 18 }, (_, i) => `t${i}`), {
    normal: [3, 5],
  });
  assert.match(String(note), /more than usual/i);
});

test("too few results names the doubt too", () => {
  const note = shapeNote([], { normal: [3, 5] });
  assert.match(String(note), /fewer than usual/i);
});

test("one source dominating the answer is called out", () => {
  // Six of eighteen from one sender is the tell that the QUESTION was wrong,
  // not the search. Nothing else catches that.
  const items = [
    ...Array.from({ length: 6 }, () => ({ from: "noreply@bulk.com" })),
    { from: "a@b.com" },
    { from: "c@d.com" },
  ];
  const note = shapeNote(items, { normal: [3, 10], sourceOf: (i) => i.from });
  assert.match(String(note), /same (sender|source)/i);
});

test("a spread of sources is not called out", () => {
  const items = ["a@b.com", "c@d.com", "e@f.com", "g@h.com"].map((from) => ({ from }));
  const note = shapeNote(items, { normal: [3, 10], sourceOf: (i) => i.from });
  assert.equal(note, null);
});

test("the note is one short clause, speakable", () => {
  // It gets appended to something she is already saying. A paragraph here
  // turns every answer into a disclaimer.
  const note = shapeNote(Array.from({ length: 40 }, (_, i) => i), { normal: [1, 3] });
  assert.ok(String(note).length < 60, `too long to speak: ${note}`);
});
