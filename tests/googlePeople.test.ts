import { test } from "node:test";
import assert from "node:assert/strict";
import { googlePeopleToContacts } from "../convex/contactsLib.ts";

// Mapping Google People API rows onto SourceContact (MOO-499).
//
// Every shape here was taken from a real response against Tarik's 4,934
// contacts, not from the API reference. What that sample established, and what
// this file exists to hold onto:
//
//   * phoneNumbers[] carries BOTH `value` (as typed) and `canonicalForm`
//     (Google's own E.164). canonicalForm is the better source when present.
//   * of 100 real contacts, 85 had no email, 34 had no phone, and 2 had no
//     name at all — sparse is the normal case, not the edge case.
//   * resourceName is "people/<id>" and is the stable per-contact id.

const person = (over: Record<string, unknown> = {}) => ({
  resourceName: "people/c123",
  names: [{ displayName: "Sarah Chen", givenName: "Sarah", familyName: "Chen" }],
  ...over,
});

test("a person becomes one source contact keyed by resourceName", () => {
  const [got] = googlePeopleToContacts([person()]);
  assert.equal(got.source, "google");
  assert.equal(got.sourceId, "people/c123");
  assert.equal(got.name, "Sarah Chen");
});

test("Google's own E.164 is preferred over the typed value", () => {
  // canonicalForm is Google's normalization and handles international better
  // than ours does. Where it exists it wins.
  const [got] = googlePeopleToContacts([
    person({
      phoneNumbers: [{ value: "(414) 555-1234", canonicalForm: "+14145551234" }],
    }),
  ]);
  assert.deepEqual(got.phones, ["+14145551234"]);
});

test("a phone with no canonicalForm still comes through", () => {
  // Google omits canonicalForm when it cannot parse the number itself.
  const [got] = googlePeopleToContacts([
    person({ phoneNumbers: [{ value: "414-555-1234" }] }),
  ]);
  assert.deepEqual(got.phones, ["414-555-1234"]);
});

test("every phone and email on a person is kept", () => {
  const [got] = googlePeopleToContacts([
    person({
      phoneNumbers: [
        { value: "414-555-1234", canonicalForm: "+14145551234" },
        { value: "414-555-9999", canonicalForm: "+14145559999" },
      ],
      emailAddresses: [{ value: "sarah@example.com" }, { value: "s.chen@work.com" }],
    }),
  ]);
  assert.deepEqual(got.phones, ["+14145551234", "+14145559999"]);
  assert.deepEqual(got.emails, ["sarah@example.com", "s.chen@work.com"]);
});

test("a contact with no phone and no email is still a contact", () => {
  // 85 of 100 real rows had no email. Dropping sparse rows would throw away
  // most of the address book.
  const [got] = googlePeopleToContacts([person()]);
  assert.deepEqual(got.phones, []);
  assert.deepEqual(got.emails, []);
  assert.equal(got.name, "Sarah Chen");
});

test("a nameless contact keeps its phone rather than being dropped", () => {
  // Two of 100 had no names[] at all. The number is the useful part.
  const [got] = googlePeopleToContacts([
    { resourceName: "people/c9", phoneNumbers: [{ canonicalForm: "+14145551234" }] },
  ]);
  assert.equal(got.name, "");
  assert.deepEqual(got.phones, ["+14145551234"]);
});

test("unstructuredName is used when displayName is absent", () => {
  const [got] = googlePeopleToContacts([
    { resourceName: "people/c8", names: [{ unstructuredName: "Marcus" }] },
  ]);
  assert.equal(got.name, "Marcus");
});

test("an empty first name entry does not hide a real one behind it", () => {
  // names[] can hold more than one entry and the first can be blank. Taking
  // names[0] leaves the contact nameless while the name sits in names[1] —
  // and a single-entry test cannot tell the two implementations apart.
  const [got] = googlePeopleToContacts([
    { resourceName: "people/c7", names: [{}, { displayName: "Marcus Reed" }] },
  ]);
  assert.equal(got.name, "Marcus Reed");
});

test("an empty organization entry does not hide a real one", () => {
  const [got] = googlePeopleToContacts([
    { resourceName: "people/c6", organizations: [{ title: "Host" }, { name: "Radio Milwaukee" }] },
  ]);
  assert.equal(got.org, "Radio Milwaukee");
});

test("organization name and title come through, photo url too", () => {
  const [got] = googlePeopleToContacts([
    person({
      organizations: [{ name: "Radio Milwaukee", title: "Host" }],
      photos: [{ url: "https://lh3.googleusercontent.com/x" }],
    }),
  ]);
  assert.equal(got.org, "Radio Milwaukee");
  assert.equal(got.photo, "https://lh3.googleusercontent.com/x");
});

test("a row with no resourceName is skipped — it has no stable identity", () => {
  // Without an id a re-sync cannot tell an edit from a new contact, so it
  // would duplicate the row on every run.
  assert.deepEqual(googlePeopleToContacts([{ names: [{ displayName: "Ghost" }] }]), []);
});

test("a deleted person is skipped rather than resurrected", () => {
  // Incremental syncs return tombstones; without this they come back as
  // contacts with no fields and overwrite the real row.
  const rows = googlePeopleToContacts([
    person(),
    { resourceName: "people/gone", metadata: { deleted: true } },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceId, "people/c123");
});

test("empty and malformed inputs produce nothing rather than throwing", () => {
  assert.deepEqual(googlePeopleToContacts([]), []);
  assert.deepEqual(googlePeopleToContacts(undefined), []);
  assert.deepEqual(googlePeopleToContacts([{}]), []);
});

test("empty string fields never become empty phones or emails", () => {
  const [got] = googlePeopleToContacts([
    person({ phoneNumbers: [{ value: "" }], emailAddresses: [{ value: "  " }] }),
  ]);
  assert.deepEqual(got.phones, []);
  assert.deepEqual(got.emails, []);
});
