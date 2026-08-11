import { test } from "node:test";
import assert from "node:assert/strict";
import { rankContacts } from "../convex/contactsLib.ts";

// Ranking for find_contact (MOO-499).
//
// The server ranks and Zola picks — the same shape as find_brief. She is
// working from a SPOKEN name, so the input is a transcript: no punctuation to
// rely on, wrong case, and often only a first name. Against a real book of
// 4,825 contacts where only 792 have a phone or email, the ranking has one
// job: put the person he means in the first few, and make ambiguity visible
// rather than guessing.

const c = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  phones: ["+14145551234"],
  emails: [],
  ...over,
});

test("an exact name beats a partial one", () => {
  const got = rankContacts([c("Marcus Reed Jr"), c("Marcus")], "Marcus", 5);
  assert.equal(got[0].name, "Marcus");
});

test("a first name finds the person who has one", () => {
  const got = rankContacts([c("Sarah Chen"), c("David Chen")], "Sarah", 5);
  assert.equal(got.length, 1);
  assert.equal(got[0].name, "Sarah Chen");
});

test("a shared surname does not drag in the wrong person", () => {
  // EVERY spoken word has to land, not just one. A single-word query cannot
  // show this — "Sarah" and "Sarah Chen" behave identically either way — so
  // it takes a two-word query against a family to prove it. Getting this
  // wrong means "text Sarah Chen" offers David as an equal candidate.
  const got = rankContacts([c("Sarah Chen"), c("David Chen")], "Sarah Chen", 5);
  assert.equal(got.length, 1);
  assert.equal(got[0].name, "Sarah Chen");
});

test("an exact name outranks a reachable near-match", () => {
  // Exact identity beats convenience: the near-match may be a different
  // person, and Zola can say she has no number for the one he named. Scores
  // alone cannot show this — an exact match always sorts first alphabetically
  // against names that extend it — so reachability has to be the thing
  // pulling the other way.
  const got = rankContacts(
    [c("Marcus", { phones: [], emails: [] }), c("Marcus Reed")],
    "Marcus",
    5,
  );
  assert.equal(got[0].name, "Marcus");
});

test("case and punctuation from a transcript do not matter", () => {
  // Speech-to-text gives "marcus reed", "Marcus Reed." or "MARCUS REED".
  for (const q of ["marcus reed", "Marcus Reed.", "MARCUS REED", "  marcus  reed  "]) {
    assert.equal(rankContacts([c("Marcus Reed"), c("Dana Poe")], q, 5)[0]?.name, "Marcus Reed", q);
  }
});

test("a surname alone still finds them", () => {
  assert.equal(rankContacts([c("Marcus Reed")], "Reed", 5)[0]?.name, "Marcus Reed");
});

test("every match for an ambiguous first name is returned, so Zola can ask", () => {
  // Two Sarahs must BOTH come back. Silently picking one is how she texts the
  // wrong person.
  const got = rankContacts([c("Sarah Chen"), c("Sarah Okonkwo"), c("Dana Poe")], "Sarah", 5);
  assert.equal(got.length, 2);
  assert.deepEqual(got.map((g) => g.name).sort(), ["Sarah Chen", "Sarah Okonkwo"]);
});

test("someone who cannot be reached ranks below someone who can", () => {
  // 4,033 of the book have no phone and no email. A name-only match is
  // useless for calling or texting, so a reachable contact wins the tie.
  const got = rankContacts(
    [c("Marcus Reed", { phones: [], emails: [] }), c("Marcus Reed")],
    "Marcus Reed",
    5,
  );
  assert.deepEqual(got[0].phones, ["+14145551234"]);
});

test("a non-match is excluded rather than ranked last", () => {
  // Returning everything with a low score hands Zola a list to guess from.
  assert.deepEqual(rankContacts([c("Sarah Chen")], "Marcus", 5), []);
});

test("the limit is honoured", () => {
  const many = Array.from({ length: 20 }, (_, i) => c(`Sarah ${i}`));
  assert.equal(rankContacts(many, "Sarah", 3).length, 3);
});

test("an empty query matches nobody", () => {
  // Otherwise "who is that" returns the first three contacts as if they were
  // answers.
  assert.deepEqual(rankContacts([c("Sarah Chen")], "", 5), []);
  assert.deepEqual(rankContacts([c("Sarah Chen")], "   ", 5), []);
});

test("a partial word matches, because transcripts truncate", () => {
  assert.equal(rankContacts([c("Marcus Reed")], "Marc", 5)[0]?.name, "Marcus Reed");
});

test("a partial SURNAME matches too", () => {
  // "Marc" is caught by the whole-name prefix branch, so it never exercises
  // per-word matching. A truncated surname does: "marcus reed" does not start
  // with "ree", so this can only pass if individual words match on prefix.
  assert.equal(rankContacts([c("Marcus Reed")], "Ree", 5)[0]?.name, "Marcus Reed");
  assert.equal(rankContacts([c("Marcus Reed")], "Reed", 5)[0]?.name, "Marcus Reed");
});

test("a nameless contact is never returned by a name search", () => {
  assert.deepEqual(rankContacts([c("", { phones: ["+14145559999"] })], "Marcus", 5), []);
});

test("searching by number finds the contact holding it", () => {
  // "who is +1 414 555 1234" and the reverse lookup a call needs.
  const got = rankContacts([c("Marcus Reed"), c("Dana Poe", { phones: ["+14145550000"] })], "414-555-1234", 5);
  assert.equal(got.length, 1);
  assert.equal(got[0].name, "Marcus Reed");
});

test("searching by email finds the contact holding it", () => {
  const got = rankContacts(
    [c("Sarah Chen", { emails: ["sarah@example.com"] }), c("Dana Poe")],
    "Sarah@Example.com",
    5,
  );
  assert.equal(got[0]?.name, "Sarah Chen");
});

test("an org match is weaker than a name match but still found", () => {
  const got = rankContacts(
    [c("Dana Poe", { org: "Radio Milwaukee" }), c("Radio Milwaukee Front Desk")],
    "Radio Milwaukee",
    5,
  );
  assert.equal(got[0].name, "Radio Milwaukee Front Desk");
  assert.equal(got.length, 2);
});

test("results are ordered deterministically when scores tie", () => {
  // A spoken disambiguation ("the first one") must mean the same thing twice.
  const people = [c("Sarah Alpha"), c("Sarah Beta"), c("Sarah Gamma")];
  assert.deepEqual(
    rankContacts(people, "Sarah", 5).map((g) => g.name),
    rankContacts([...people].reverse(), "Sarah", 5).map((g) => g.name),
  );
});
