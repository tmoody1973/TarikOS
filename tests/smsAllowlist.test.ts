import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedSender, normalizeE164 } from "../src/lib/smsAllowlist.ts";

// MOO-497. The SMS number is public by construction — anyone who learns it can
// text it, and unlike /f/<slug> there is no secret in the address at all. So
// the allowlist is the entire access control on the inbound side, and it is
// the only thing standing between a stranger and a conversation with an agent
// that has Tarik's calendar, mail and second brain wired to it.
//
// Denial is silent on purpose: a reply of any kind, even a refusal, confirms
// the number is live and costs Tarik a message segment per probe.

const OWNER = "+14145551212";

test("the owner's own number is allowed", () => {
  assert.equal(isAllowedSender(OWNER, OWNER), true);
});

test("a stranger is not", () => {
  assert.equal(isAllowedSender("+15558675309", OWNER), false);
});

test("formatting differences do not decide access", () => {
  // Telnyx sends E.164, but the env var is hand-typed and a human writes a
  // number however they think of it. A gate that fails on a dash would look
  // like the integration is broken.
  for (const written of [
    "(414) 555-1212",
    "414-555-1212",
    "4145551212",
    "1 414 555 1212",
    " +1 (414) 555-1212 ",
  ]) {
    assert.equal(
      isAllowedSender(OWNER, written),
      true,
      `${written} is the same number`,
    );
  }
});

test("a number that merely ends the same way is refused", () => {
  // Suffix matching is the tempting shortcut here and it is wrong: +15551212
  // would match, and so would a number in another country.
  assert.equal(isAllowedSender("+9995551212", OWNER), false);
});

test("no configured owner means nobody is allowed", () => {
  // Fails closed. An unset OWNER_PHONE in production must not turn the number
  // into an open line to Tarik's assistant.
  assert.equal(isAllowedSender(OWNER, undefined), false);
  assert.equal(isAllowedSender(OWNER, ""), false);
  assert.equal(isAllowedSender(OWNER, "   "), false);
});

test("a missing sender is refused", () => {
  // The webhook's `from` shape is not in Telnyx's documented payload table, so
  // the parser may well hand this an undefined one day.
  assert.equal(isAllowedSender(undefined, OWNER), false);
  assert.equal(isAllowedSender(null, OWNER), false);
  assert.equal(isAllowedSender("", OWNER), false);
});

test("normalizeE164 keeps the country code and drops everything else", () => {
  assert.equal(normalizeE164("(414) 555-1212"), "+14145551212");
  assert.equal(normalizeE164("+14145551212"), "+14145551212");
  assert.equal(normalizeE164("+44 20 7946 0958"), "+442079460958");
});

test("a ten-digit US number gains its country code", () => {
  // Tarik will type ten digits. Telnyx will send eleven with a plus.
  assert.equal(normalizeE164("4145551212"), "+14145551212");
});

test("normalizeE164 refuses to invent a number from nonsense", () => {
  assert.equal(normalizeE164("not a phone"), "");
  assert.equal(normalizeE164(""), "");
  assert.equal(normalizeE164(undefined), "");
});
