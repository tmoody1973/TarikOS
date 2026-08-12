import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REMINDER_CHANNELS,
  askedForACall,
  channelOf,
  describeReminders,
  matchReminders,
  reminderAt,
  spokenTime,
} from "../convex/remindersLib.ts";

// Reminders: the pure half, decided without a database or a clock.
//
// The rule shaping most of this: a reminder is a promise to interrupt someone
// later. A promise that fires at the wrong time, or fires instantly because a
// time was mis-parsed, is worse than no promise at all.

const NOW = Date.UTC(2026, 7, 12, 12, 0, 0); // 2026-08-12 07:00 Chicago

// ----------------------------------------------------------- scheduling

test("a reminder in the past is refused rather than fired at once", () => {
  // A time already gone means the model mis-parsed, not that Tarik wanted an
  // instant interruption. Firing immediately would make a mis-hearing look
  // like the feature working.
  const built = reminderAt("call the bank", "2026-08-12T06:00:00", NOW);
  assert.equal(built.ok, false);
});

test("a reminder a minute from now is fine", () => {
  const built = reminderAt("call the bank", "2026-08-12T07:01:00", NOW);
  assert.equal(built.ok, true);
});

test("a reminder with nothing to say is refused", () => {
  assert.equal(reminderAt("   ", "2026-08-12T09:00:00", NOW).ok, false);
});

test("a reminder more than a year out is refused as a mis-parse", () => {
  // "Remind me in 2027" is a real sentence; "remind me on the 3rd" resolving to
  // the year 3024 is a parsing accident, and the two look identical here.
  assert.equal(reminderAt("x", "2031-08-12T09:00:00", NOW).ok, false);
});

test("an unreadable time is refused rather than guessed at", () => {
  assert.equal(reminderAt("x", "next tuesdayish", NOW).ok, false);
});

test("a scheduled reminder keeps the exact instant it was given", () => {
  const built = reminderAt("call the bank", "2026-08-12T09:30:00", NOW);
  assert.ok(built.ok);
  assert.equal(built.ok && built.dueAt, Date.parse("2026-08-12T09:30:00-05:00"));
});

test("a reminder set in summer for winter lands on standard time", () => {
  // THE case the offset resolution exists for. Chicago is UTC-5 today and
  // UTC-6 in December; a fixed offset, or the offset at the moment of asking,
  // puts this an hour wrong. Nobody would notice until the reminder arrived.
  const built = reminderAt("renew the domain", "2026-12-15T09:30:00", NOW);
  assert.ok(built.ok);
  assert.equal(built.ok && built.dueAt, Date.parse("2026-12-15T09:30:00-06:00"));
});

test("a winter reminder is read back at the time it was set for", () => {
  // The round trip, not just the parse: set 9:30 in December, hear 9:30.
  const built = reminderAt("renew the domain", "2026-12-15T09:30:00", NOW);
  assert.ok(built.ok);
  assert.match(built.ok ? spokenTime(built.dueAt) : "", /9:30/);
});

// ------------------------------------------------------------- channels

test("a phone call is deliberately not a reminder channel", () => {
  // Zola can already ring him, but that path is guarded by three tests
  // asserting exactly one dialling site whose destination is not a parameter.
  // A reminder is not worth a second one.
  assert.deepEqual([...REMINDER_CHANNELS], ["telegram", "email"]);
});

test("asking to be called is texted instead, and it is not silent", () => {
  assert.equal(channelOf("call me"), "telegram");
  assert.equal(askedForACall("call me"), true);
  assert.equal(askedForACall("email me"), false);
});

test("a channel nobody recognises falls back to telegram", () => {
  // A reminder that arrives the wrong way still arrives. One that throws on an
  // unexpected word is a reminder that silently never happens.
  assert.equal(channelOf("carrier pigeon"), "telegram");
  assert.equal(channelOf(undefined), "telegram");
});

test("the words a person says for each channel are understood", () => {
  assert.equal(channelOf("text me"), "telegram");
  assert.equal(channelOf("Email"), "email");
});

// ------------------------------------------------------- reading it back

test("the confirmation names the time in Tarik's own timezone", () => {
  // Stored in UTC, spoken in Chicago. A reminder read back as "12 PM" for a
  // 7 AM alarm is how someone stops trusting the feature.
  const said = spokenTime(Date.parse("2026-08-12T09:30:00-05:00"));
  assert.match(said, /9:30/);
  assert.doesNotMatch(said, /14:30|2:30 PM/);
});

test("pending reminders read as a sentence, not a list", () => {
  const said = describeReminders([
    { text: "call the bank", dueAt: Date.parse("2026-08-12T09:30:00-05:00") },
    { text: "book the venue", dueAt: Date.parse("2026-08-13T10:00:00-05:00") },
  ]);
  assert.match(said, /call the bank/);
  assert.match(said, /book the venue/);
  assert.doesNotMatch(said, /[|\n]/);
});

test("nothing pending is said plainly", () => {
  const said = describeReminders([]);
  assert.match(said, /nothing|no reminders/i);
});

// -------------------------------------------------------- cancelling one

test("a quote resolves to the one reminder containing it", () => {
  const found = matchReminders(
    [
      { id: "a", text: "call the bank", dueAt: 1 },
      { id: "b", text: "book the venue", dueAt: 2 },
    ],
    "bank",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "a");
});

test("a quote matching two reminders returns both, so she can ask", () => {
  const found = matchReminders(
    [
      { id: "a", text: "call the bank", dueAt: 1 },
      { id: "b", text: "call the venue", dueAt: 2 },
    ],
    "call the",
  );
  assert.equal(found.length, 2);
});

test("an empty quote cancels nothing", () => {
  // Otherwise a dropped word wipes every pending reminder at once.
  assert.equal(matchReminders([{ id: "a", text: "x", dueAt: 1 }], "  ").length, 0);
});
