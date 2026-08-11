import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, normalizeEmail, identityKeys } from "../convex/contactsLib.ts";

// Phone normalization is the load-bearing piece of this whole feature (MOO-499).
//
// It decides two separate things, and both break quietly when it is wrong:
// whether two records are the SAME PERSON (dedupe across Google and iCloud),
// and what string gets handed to Telnyx to actually dial. A number that
// normalizes two different ways produces a duplicate contact; one that
// normalizes wrongly produces a call to a stranger.
//
// Default region is US — Tarik is in Milwaukee and every provider hands back
// a mix of "(414) 555-1234", "414-555-1234" and "+1 414 555 1234" for the
// same person.

test("the same US number in every format Google and iCloud emit collapses to one", () => {
  const forms = [
    "(414) 555-1234",
    "414-555-1234",
    "414.555.1234",
    "414 555 1234",
    "4145551234",
    "14145551234",
    "1-414-555-1234",
    "+1 414 555 1234",
    "+1 (414) 555-1234",
    "+14145551234",
    "  +1 414 555 1234  ",
  ];
  const got = new Set(forms.map(normalizePhone));
  assert.equal(got.size, 1, [...got].join(" | "));
  assert.equal([...got][0], "+14145551234");
});

test("an international number keeps its own country code", () => {
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("+442079460958"), "+442079460958");
});

test("a US-dialed international prefix becomes a real country code", () => {
  // 011 is how a US phone dials out; it is not part of the number.
  assert.equal(normalizePhone("011 44 20 7946 0958"), "+442079460958");
});

test("a number with no area code cannot be dialled, so it is not a number", () => {
  // Seven digits was fine in 1985. It cannot be called from a mobile now, and
  // treating it as valid would merge two people who share a local number.
  assert.equal(normalizePhone("555-1234"), null);
  assert.equal(normalizePhone("5551234"), null);
});

test("junk and empties are rejected rather than half-parsed", () => {
  for (const junk of ["", "   ", "-", "()", "abc", "n/a", "unknown"]) {
    assert.equal(normalizePhone(junk), null, junk);
  }
  assert.equal(normalizePhone(undefined), null);
  assert.equal(normalizePhone(null), null);
});

test("a vanity number is rejected, not silently mangled", () => {
  // 1-800-FLOWERS has letters; stripping them yields a wrong, dialable number.
  assert.equal(normalizePhone("1-800-FLOWERS"), null);
  assert.equal(normalizePhone("414-555-CALL"), null);
});

test("stray letters reject the value even when the digits look dialable", () => {
  // The cases above are also caught by length, so they do not prove the letter
  // guard does anything. These do: ten valid digits with text attached. The
  // strict answer is deliberate — an unexpected character means the value was
  // not understood, and a contact missing one number is recoverable while a
  // contact holding a wrong one is not.
  assert.equal(normalizePhone("414-555-1234 (mobile)"), null);
  assert.equal(normalizePhone("4145551234abc"), null);
  assert.equal(normalizePhone("call 4145551234"), null);
});

test("an extension is dropped — it is not part of the dialable number", () => {
  assert.equal(normalizePhone("414-555-1234 x99"), "+14145551234");
  assert.equal(normalizePhone("(414) 555-1234 ext. 202"), "+14145551234");
  assert.equal(normalizePhone("414-555-1234;123"), "+14145551234");
});

test("E.164 length limits are enforced at both ends", () => {
  // Max 15 digits after the +. Longer is not a phone number, and letting it
  // through hands Telnyx something it will reject at call time instead.
  assert.equal(normalizePhone("+1234567890123456"), null);
  assert.equal(normalizePhone("+123456789012345"), "+123456789012345");
  assert.equal(normalizePhone("+1"), null);
});

test("an 11-digit number that does not start with 1 is not a US number", () => {
  // Guessing a country code here is how a contact gets an undialable number.
  assert.equal(normalizePhone("44207946095"), null);
});

test("a US number cannot start with 0 or 1 in the area code", () => {
  assert.equal(normalizePhone("014-555-1234"), null);
  assert.equal(normalizePhone("114-555-1234"), null);
});

test("emails normalize case and whitespace but never the local part", () => {
  assert.equal(normalizeEmail("  Sarah.Chen@Example.COM "), "sarah.chen@example.com");
  assert.equal(normalizeEmail("sarah.chen@example.com"), "sarah.chen@example.com");
});

test("dots in the local part are preserved — they distinguish people", () => {
  // Gmail ignores dots; almost nothing else does. Stripping them merges two
  // different people at every other domain.
  assert.notEqual(
    normalizeEmail("s.chen@example.com"),
    normalizeEmail("schen@example.com"),
  );
});

test("a non-address is rejected rather than stored as a contact email", () => {
  for (const junk of ["", "  ", "sarah", "sarah@", "@example.com", "a b@c.com"]) {
    assert.equal(normalizeEmail(junk), null, junk);
  }
  assert.equal(normalizeEmail(undefined), null);
});

// identityKeys is what dedupe matches on: two provider records are the same
// person when they share ANY normalized phone or email.

test("identity keys are the normalized phones and emails, deduped", () => {
  const keys = identityKeys({
    phones: ["(414) 555-1234", "+1 414 555 1234"],
    emails: ["Sarah.Chen@Example.com"],
  });
  assert.deepEqual(keys.sort(), ["email:sarah.chen@example.com", "tel:+14145551234"]);
});

test("phone and email keys cannot collide with each other", () => {
  // Namespaced, so a contact whose email is literally a number string can
  // never match another contact's phone.
  const keys = identityKeys({ phones: ["4145551234"], emails: [] });
  assert.ok(keys.every((k) => k.startsWith("tel:")));
});

test("unusable values contribute no keys at all", () => {
  // A contact with only a 7-digit number has NO identity — it must never
  // match another keyless contact, or every such record merges into one blob.
  assert.deepEqual(identityKeys({ phones: ["555-1234"], emails: ["nope"] }), []);
  assert.deepEqual(identityKeys({ phones: [], emails: [] }), []);
  assert.deepEqual(identityKeys({}), []);
});
