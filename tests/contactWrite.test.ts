import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPersonPayload } from "../convex/contactsLib.ts";

// Building a Google People createContact body (MOO-499 write-through).
//
// This writes into a real address book of 4,825 people, from a spoken
// instruction, through a transcript. So it refuses far more than it accepts:
// a wrong number saved under a right name is worse than no contact at all,
// and unlike a read there is nothing to undo it on the next sync.
//
// Shape verified against a real createContact call before this was written —
// givenName/familyName and phoneNumbers[].value are what Google accepted.

test("a name and a phone become a valid person", () => {
  const got = buildPersonPayload({ name: "Marcus Reed", phone: "414-555-1234" });
  assert.deepEqual(got, {
    ok: true,
    person: {
      names: [{ givenName: "Marcus", familyName: "Reed" }],
      phoneNumbers: [{ value: "+14145551234" }],
    },
  });
});

test("the number is stored in E.164, not as it was spoken", () => {
  // The same normalization dedupe uses, so the contact we write matches the
  // contact we would have read back.
  const got = buildPersonPayload({ name: "Marcus", phone: "(414) 555-1234" });
  assert.equal(got.person?.phoneNumbers?.[0].value, "+14145551234");
});

test("a single-word name has no family name invented for it", () => {
  const got = buildPersonPayload({ name: "Marcus", phone: "4145551234" });
  assert.deepEqual(got.person?.names, [{ givenName: "Marcus" }]);
});

test("a three-part name keeps everything after the first word together", () => {
  const got = buildPersonPayload({ name: "Sarah A Chen", phone: "4145551234" });
  assert.deepEqual(got.person?.names, [{ givenName: "Sarah", familyName: "A Chen" }]);
});

test("an email-only contact is allowed", () => {
  const got = buildPersonPayload({ name: "Sarah Chen", email: "Sarah.Chen@Example.com" });
  assert.equal(got.ok, true);
  assert.deepEqual(got.person?.emailAddresses, [{ value: "sarah.chen@example.com" }]);
  assert.equal(got.person?.phoneNumbers, undefined);
});

test("an org is included when given and omitted when not", () => {
  assert.deepEqual(
    buildPersonPayload({ name: "Dana Poe", phone: "4145551234", org: "Radio Milwaukee" }).person
      ?.organizations,
    [{ name: "Radio Milwaukee" }],
  );
  assert.equal(
    buildPersonPayload({ name: "Dana Poe", phone: "4145551234" }).person?.organizations,
    undefined,
  );
});

test("a contact with no name is refused", () => {
  const got = buildPersonPayload({ name: "  ", phone: "4145551234" });
  assert.equal(got.ok, false);
  assert.match(got.error!, /name/i);
});

test("a contact with neither phone nor email is refused", () => {
  // A name alone cannot be called, texted or emailed, which is the entire
  // reason this feature exists.
  const got = buildPersonPayload({ name: "Marcus Reed" });
  assert.equal(got.ok, false);
  assert.match(got.error!, /number or an email/i);
});

test("an unusable number is refused rather than saved as typed", () => {
  // The critical one. Saving "555-1234" verbatim produces a contact that
  // cannot be dialled, under a name that looks correct — and nothing later
  // will flag it, because the sync only reads.
  for (const bad of ["555-1234", "1-800-FLOWERS", "abc", "12"]) {
    const got = buildPersonPayload({ name: "Marcus Reed", phone: bad });
    assert.equal(got.ok, false, bad);
    assert.match(got.error!, /number/i);
  }
});

test("an unusable email is refused rather than saved", () => {
  const got = buildPersonPayload({ name: "Marcus Reed", email: "marcus at example" });
  assert.equal(got.ok, false);
  assert.match(got.error!, /email/i);
});

test("a refusal never carries a person to write", () => {
  // Belt and braces: the route must not be able to send a body from a
  // rejected payload by ignoring `ok`.
  for (const bad of [
    { name: "", phone: "4145551234" },
    { name: "X", phone: "555-1234" },
    { name: "X" },
  ]) {
    assert.equal(buildPersonPayload(bad).person, undefined, JSON.stringify(bad));
  }
});

test("both a phone and an email can be given at once", () => {
  const got = buildPersonPayload({
    name: "Sarah Chen",
    phone: "4145551234",
    email: "sarah@example.com",
  });
  assert.equal(got.ok, true);
  assert.equal(got.person?.phoneNumbers?.length, 1);
  assert.equal(got.person?.emailAddresses?.length, 1);
});

test("surrounding whitespace in a spoken name is trimmed", () => {
  assert.deepEqual(
    buildPersonPayload({ name: "  Marcus   Reed  ", phone: "4145551234" }).person?.names,
    [{ givenName: "Marcus", familyName: "Reed" }],
  );
});
