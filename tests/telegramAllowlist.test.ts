import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedChat,
  normalizeChatId,
  secretMatches,
} from "../src/lib/telegramAllowlist.ts";

// A bot's username is discoverable and anyone can open a chat with it. So, as
// with SMS, this list is the whole inbound access control on an assistant that
// holds Tarik's calendar, mail and second brain.
//
// Unlike SMS there is no signature to fall back on: Telegram proves it sent
// the request with a shared secret in a plain header, which is a password.

const OWNER = "123456789";

test("the owner's chat is allowed, as a number or a string", () => {
  // Telegram sends the id as a JSON number; the env var is a string.
  assert.equal(isAllowedChat(123456789, OWNER), true);
  assert.equal(isAllowedChat("123456789", OWNER), true);
  assert.equal(isAllowedChat(" 123456789 ", OWNER), true);
});

test("anyone else is refused", () => {
  assert.equal(isAllowedChat(987654321, OWNER), false);
  assert.equal(isAllowedChat("12345678", OWNER), false, "prefix is not a match");
  assert.equal(isAllowedChat("1234567890", OWNER), false, "nor is a suffix");
});

test("no configured owner means nobody is allowed", () => {
  assert.equal(isAllowedChat(123456789, undefined), false);
  assert.equal(isAllowedChat(123456789, ""), false);
  assert.equal(isAllowedChat(123456789, "  "), false);
  assert.equal(isAllowedChat(123456789, "not-an-id"), false);
});

test("a group id keeps its sign", () => {
  // Groups and supergroups have negative ids and are legitimate chats.
  assert.equal(normalizeChatId(-1001234567890), "-1001234567890");
  assert.equal(isAllowedChat(-1001234567890, "-1001234567890"), true);
});

test("an id too large to survive JSON is refused, not rounded", () => {
  // JSON numbers are doubles. Past 2^53 the value that arrives is not the
  // value that was sent, and an identity that has silently changed must not
  // be matched against anything.
  assert.equal(normalizeChatId(Number.MAX_SAFE_INTEGER + 2), "");
  assert.equal(normalizeChatId(1.5), "");
});

test("nonsense is never an id", () => {
  for (const junk of ["", "abc", "12a", null, undefined, {}, [], true]) {
    assert.equal(normalizeChatId(junk), "", `${JSON.stringify(junk)}`);
  }
});

test("the webhook secret must match exactly", () => {
  assert.equal(secretMatches("s3cret", "s3cret"), true);
  assert.equal(secretMatches("s3cret", "wrong!"), false);
  assert.equal(secretMatches("s3cre", "s3cret"), false, "length differs");
  assert.equal(secretMatches("s3crett", "s3cret"), false);
});

test("an unset secret refuses everything, including an empty header", () => {
  // Otherwise a deploy that forgot the env var would accept every caller,
  // and the failure would look like success.
  assert.equal(secretMatches("anything", undefined), false);
  assert.equal(secretMatches("", undefined), false);
  assert.equal(secretMatches("", ""), false);
  assert.equal(secretMatches(null, "s3cret"), false);
  assert.equal(secretMatches(undefined, "s3cret"), false);
});
