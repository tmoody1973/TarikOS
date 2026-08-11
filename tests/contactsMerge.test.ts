import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeContacts, compatibleNames, type SourceContact } from "../convex/contactsLib.ts";

// Dedupe across Google and iCloud (MOO-499).
//
// Two provider records are the same person when they share a normalized phone
// or email — matched transitively, because Google may carry the email and
// iCloud the phone with a third record bridging them.
//
// The failure mode worth designing against is the SHARED HOUSEHOLD NUMBER.
// Two people on one landline share an identity key while being different
// people, and a naive union merges them into a single contact that then
// answers "call my mom" with the wrong name attached. So a shared key is
// necessary but not sufficient: the names must also be compatible.

const rec = (over: Partial<SourceContact> = {}): SourceContact => ({
  source: "google",
  sourceId: "g1",
  name: "Sarah Chen",
  phones: [],
  emails: [],
  ...over,
});

test("a contact in both sources becomes one record keeping both source ids", () => {
  const merged = mergeContacts([
    rec({ source: "google", sourceId: "g1", phones: ["(414) 555-1234"] }),
    rec({ source: "icloud", sourceId: "i1", phones: ["+1 414 555 1234"] }),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources.map((s) => `${s.source}:${s.sourceId}`).sort(), [
    "google:g1",
    "icloud:i1",
  ]);
});

test("the merged record carries the union of phones and emails, normalized", () => {
  const merged = mergeContacts([
    rec({ sourceId: "g1", phones: ["(414) 555-1234"], emails: ["Sarah.Chen@Example.com"] }),
    rec({
      source: "icloud",
      sourceId: "i1",
      phones: ["414-555-1234", "414-555-9999"],
      emails: ["sarah.chen@example.com"],
    }),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].phones.sort(), ["+14145551234", "+14145559999"]);
  assert.deepEqual(merged[0].emails, ["sarah.chen@example.com"]);
});

test("matching is transitive across a bridging record", () => {
  // Google has the email, iCloud has the phone, a third record carries both.
  const merged = mergeContacts([
    rec({ sourceId: "a", phones: [], emails: ["sarah.chen@example.com"] }),
    rec({ source: "icloud", sourceId: "b", phones: ["4145551234"], emails: [] }),
    rec({ source: "icloud", sourceId: "c", phones: ["4145551234"], emails: ["sarah.chen@example.com"] }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sources.length, 3);
});

test("two people sharing a household landline stay two people", () => {
  // The whole reason a shared key is not sufficient on its own.
  const merged = mergeContacts([
    rec({ sourceId: "m", name: "Rita Moody", phones: ["414-555-0000"] }),
    rec({ sourceId: "d", name: "Gerald Moody", phones: ["414-555-0000"] }),
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((m) => m.name).sort(), ["Gerald Moody", "Rita Moody"]);
});

test("records with no usable phone or email never merge with each other", () => {
  // Keyless records have nothing in common. Merging them would collapse every
  // name-only contact in the book into a single record.
  const merged = mergeContacts([
    rec({ sourceId: "x", name: "Alice", phones: ["555-1234"], emails: [] }),
    rec({ sourceId: "y", name: "Bob", phones: [], emails: [] }),
  ]);
  assert.equal(merged.length, 2);
});

test("the same source id is not duplicated if a record appears twice", () => {
  const merged = mergeContacts([
    rec({ sourceId: "g1", phones: ["4145551234"] }),
    rec({ sourceId: "g1", phones: ["4145551234"] }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sources.length, 1);
});

test("the longest name wins, so 'Sarah' does not overwrite 'Sarah Chen'", () => {
  const merged = mergeContacts([
    rec({ sourceId: "g1", name: "Sarah", phones: ["4145551234"] }),
    rec({ source: "icloud", sourceId: "i1", name: "Sarah Chen", phones: ["4145551234"] }),
  ]);
  assert.equal(merged[0].name, "Sarah Chen");
});

test("an org is kept when any source has one", () => {
  const merged = mergeContacts([
    rec({ sourceId: "g1", phones: ["4145551234"], org: undefined }),
    rec({ source: "icloud", sourceId: "i1", phones: ["4145551234"], org: "Radio Milwaukee" }),
  ]);
  assert.equal(merged[0].org, "Radio Milwaukee");
});

test("unusable phone values are dropped rather than stored", () => {
  const merged = mergeContacts([
    rec({ sourceId: "g1", phones: ["4145551234", "555-1234", "1-800-FLOWERS"] }),
  ]);
  assert.deepEqual(merged[0].phones, ["+14145551234"]);
});

test("output follows input order, so a re-sync does not rewrite every row", () => {
  // Comparing a reversed input against a reversed output only proves symmetry
  // — a sort that reverses everything passes that. This pins the actual order.
  const names = ["Alice", "Bob", "Carol"];
  const records = names.map((name, i) =>
    rec({ sourceId: name, name, phones: [`41455511${11 + i}`] }),
  );
  assert.deepEqual(mergeContacts(records).map((m) => m.name), names);
  assert.deepEqual(
    mergeContacts([records[2], records[0], records[1]]).map((m) => m.name),
    ["Carol", "Alice", "Bob"],
  );
});

test("a merged record takes the position of its earliest member", () => {
  const merged = mergeContacts([
    rec({ sourceId: "a", name: "Alice", phones: ["4145551111"] }),
    rec({ sourceId: "b", name: "Bob", phones: ["4145552222"] }),
    rec({ source: "icloud", sourceId: "a2", name: "Alice", phones: ["4145551111"] }),
  ]);
  assert.deepEqual(merged.map((m) => m.name), ["Alice", "Bob"]);
  assert.equal(merged[0].sources.length, 2);
});

test("an empty input is an empty result, not a crash", () => {
  assert.deepEqual(mergeContacts([]), []);
});

// compatibleNames is the predicate that keeps the household case apart.

test("a missing name never blocks a merge", () => {
  assert.ok(compatibleNames("", "Sarah Chen"));
  assert.ok(compatibleNames("Sarah Chen", ""));
  assert.ok(compatibleNames("", ""));
});

test("a shorter name that is part of the longer one is compatible", () => {
  assert.ok(compatibleNames("Sarah", "Sarah Chen"));
  assert.ok(compatibleNames("Sarah Chen", "Sarah A Chen"));
  assert.ok(compatibleNames("sarah chen", "Sarah Chen"));
  assert.ok(compatibleNames("Chen, Sarah", "Sarah Chen"));
});

test("two different first names are not compatible", () => {
  assert.ok(!compatibleNames("Rita Moody", "Gerald Moody"));
  assert.ok(!compatibleNames("Sarah Chen", "David Chen"));
});

test("punctuation and spacing do not decide identity", () => {
  assert.ok(compatibleNames("Sarah  Chen", "Sarah Chen"));
  assert.ok(compatibleNames("O'Brien, Sean", "Sean O'Brien"));
});
