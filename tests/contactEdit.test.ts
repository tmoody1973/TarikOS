import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpdatePayload } from "../convex/contactsLib.ts";

// Changing a contact that already exists (MOO-499 edit).
//
// Harder than creating one. A create that goes wrong leaves a bad row next to
// the good ones; an update that goes wrong destroys something that was right,
// and Google keeps no undo. Google's updateContact replaces a whole field —
// there is no "change the second number" — so every accepted change has to
// report what it displaced, or a person with a mobile and a work line loses
// one silently and nobody finds out until someone dials it.

const marcus = {
  names: [{ givenName: "Marcus", familyName: "Reed" }],
  phoneNumbers: [{ value: "+14145551234" }],
  emailAddresses: [{ value: "marcus@example.com" }],
};

test("a new number becomes a phoneNumbers update and nothing else", () => {
  const got = buildUpdatePayload(marcus, { phone: "414-555-9999" });
  assert.equal(got.ok, true);
  assert.deepEqual(got.person?.phoneNumbers, [{ value: "+14145559999" }]);
  assert.equal(got.updatePersonFields, "phoneNumbers");
  // Anything named in updatePersonFields is overwritten by this body, so a
  // field we were not asked to change must not appear in either.
  assert.equal(got.person?.emailAddresses, undefined);
  assert.equal(got.person?.names, undefined);
});

test("the number is normalized the same way a saved one is", () => {
  const got = buildUpdatePayload(marcus, { phone: "(414) 555-9999" });
  assert.equal(got.person?.phoneNumbers?.[0].value, "+14145559999");
});

test("what the change displaces comes back, so it can be read out", () => {
  // The whole safety story for edits. Google replaces the field wholesale, so
  // this is the only chance to say what is about to disappear.
  const got = buildUpdatePayload(
    { ...marcus, phoneNumbers: [{ value: "+14145551234" }, { value: "+14145550000" }] },
    { phone: "4145559999" },
  );
  assert.deepEqual(got.replaced, [
    { field: "phone", from: ["+14145551234", "+14145550000"], to: "+14145559999" },
  ]);
});

test("a field that was empty reports an empty from, not a missing one", () => {
  const got = buildUpdatePayload({ names: [{ givenName: "Marcus" }] }, { email: "m@example.com" });
  assert.deepEqual(got.replaced, [{ field: "email", from: [], to: "m@example.com" }]);
});

test("two fields at once produce one masked update", () => {
  const got = buildUpdatePayload(marcus, { phone: "4145559999", org: "Radio Milwaukee" });
  assert.equal(got.ok, true);
  assert.deepEqual(got.person?.organizations, [{ name: "Radio Milwaukee" }]);
  // Order-independent: the mask is a set, and asserting the string would pass
  // for the wrong reason if only one field made it in.
  assert.deepEqual(got.updatePersonFields?.split(",").sort(), ["organizations", "phoneNumbers"]);
  assert.equal(got.replaced?.length, 2);
});

test("a renamed contact splits the same way a new one does", () => {
  const got = buildUpdatePayload(marcus, { name: "Sarah A Chen" });
  assert.deepEqual(got.person?.names, [{ givenName: "Sarah", familyName: "A Chen" }]);
  assert.equal(got.updatePersonFields, "names");
  assert.deepEqual(got.replaced, [{ field: "name", from: ["Marcus Reed"], to: "Sarah A Chen" }]);
});

test("asking for nothing is refused rather than sent as an empty write", () => {
  // Matched on the whole sentence, not a word in it. "What should I change"
  // and "that's already what I have saved" are different answers to different
  // mistakes, and a /what/i assertion here accepted either — a mutation that
  // deleted this branch entirely passed the test.
  const got = buildUpdatePayload(marcus, {});
  assert.equal(got.ok, false);
  assert.equal(got.person, undefined);
  assert.match(got.error!, /what should I change/i);
  assert.ok(!/already/i.test(got.error!), "asking for nothing is not the same as a no-op change");
});

test("an unusable number is refused, exactly as it is on a new contact", () => {
  // Same bar as add_contact. An edit that saves "555-1234" over a number that
  // worked is strictly worse than refusing: it destroys a good value.
  for (const bad of ["555-1234", "1-800-FLOWERS", "abc", "12"]) {
    const got = buildUpdatePayload(marcus, { phone: bad });
    assert.equal(got.ok, false, bad);
    assert.equal(got.person, undefined, bad);
    assert.match(got.error!, /number/i);
  }
});

test("an unusable email is refused", () => {
  const got = buildUpdatePayload(marcus, { email: "marcus at example" });
  assert.equal(got.ok, false);
  assert.equal(got.person, undefined);
  assert.match(got.error!, /email/i);
});

test("a rename to nothing is refused", () => {
  const got = buildUpdatePayload(marcus, { name: "   " });
  assert.equal(got.ok, false);
  assert.match(got.error!, /name/i);
});

test("setting a value it already has is reported, not written", () => {
  // Not an error — the world is already how he asked for it. But writing it
  // burns a quota call and a new etag for no change at all.
  const got = buildUpdatePayload(marcus, { phone: "(414) 555-1234" });
  assert.equal(got.ok, false);
  assert.equal(got.person, undefined);
  assert.match(got.error!, /already/i);
});

test("one unchanged field among several does not block the others", () => {
  const got = buildUpdatePayload(marcus, { phone: "4145551234", org: "Radio Milwaukee" });
  assert.equal(got.ok, true);
  assert.equal(got.updatePersonFields, "organizations");
  assert.deepEqual(got.replaced, [{ field: "org", from: [], to: "Radio Milwaukee" }]);
});

test("a refusal never carries a body to send", () => {
  for (const bad of [{}, { phone: "555-1234" }, { name: "" }, { email: "nope" }]) {
    const got = buildUpdatePayload(marcus, bad);
    assert.equal(got.person, undefined, JSON.stringify(bad));
    assert.equal(got.updatePersonFields, undefined, JSON.stringify(bad));
  }
});

test("an empty current record is handled without throwing", () => {
  // Google returns the fields it was asked for; a contact with no name at all
  // is real — 4,033 of the book are barely more than an address.
  const got = buildUpdatePayload({}, { phone: "4145559999" });
  assert.equal(got.ok, true);
  assert.deepEqual(got.replaced, [{ field: "phone", from: [], to: "+14145559999" }]);
});
