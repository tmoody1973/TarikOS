import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPLY_ZERO_INBOX_BASE,
  REPLY_ZERO_SENT_QUERY,
  SITTING_AFTER_HOURS,
  describeWait,
  findSittingThreads,
  isBroadcast,
  speakSitting,
  type ReplyZeroMessage,
  type SittingThread,
} from "../src/lib/replyZero.ts";

// The one thing this tool has to get right is not crying wolf: a thread he
// already answered must never be read out as unanswered. Every test below
// was checked by breaking the source it protects and watching it fail.

const NOW = Date.parse("2026-08-14T00:00:00Z");
const HOUR = 3_600_000;

function ago(hours: number): string {
  return new Date(NOW - hours * HOUR).toISOString();
}

function inbound(over: Partial<ReplyZeroMessage> = {}): ReplyZeroMessage {
  return {
    threadId: "t1",
    account: "work-gmail",
    from: "Valeria",
    subject: "Studio quote",
    date: ago(48),
    ...over,
  };
}

function outbound(over: Partial<ReplyZeroMessage> = {}): ReplyZeroMessage {
  return {
    threadId: "t1",
    account: "work-gmail",
    from: "Tarik Moody",
    subject: "Re: Studio quote",
    date: ago(24),
    ...over,
  };
}

function run(
  inbox: ReplyZeroMessage[],
  sent: ReplyZeroMessage[] = [],
  minHours?: number,
): SittingThread[] {
  return findSittingThreads({ inbox, sent, now: NOW, minHours });
}

test("an unanswered thread is awaiting him", () => {
  const [t] = run([inbound()]);
  assert.equal(t.direction, "awaiting_you");
  assert.equal(t.who, "Valeria");
  assert.equal(t.threadId, "t1");
  assert.equal(t.hoursWaiting, 48);
});

test("a reply he sent later clears it — the whole reason for the sent query", () => {
  // The live-verified case: inbound at -48h, his answer at -24h.
  const [t] = run([inbound()], [outbound()]);
  assert.equal(t.direction, "awaiting_them");
});

test("a reply he sent BEFORE their message does not clear it", () => {
  // He wrote Monday, they wrote back Tuesday, and he never answered that.
  const [t] = run([inbound({ date: ago(24) })], [outbound({ date: ago(72) })]);
  assert.equal(t.direction, "awaiting_you");
});

test("a sent message on a different thread does not clear it", () => {
  const [t] = run([inbound()], [outbound({ threadId: "t2" })]);
  assert.equal(t.direction, "awaiting_you");
});

test("the same threadId under a different account is a different thread", () => {
  // Threads are keyed per account: two Gmail accounts can and do collide.
  const [t] = run([inbound()], [outbound({ account: "personal-gmail" })]);
  assert.equal(t.direction, "awaiting_you");
});

test("cold outbound is not a sitting thread", () => {
  // He mailed someone who never wrote back and never had. Real Reply Zero
  // counts that; here it would bury the threads he can actually act on.
  assert.deepEqual(run([], [outbound()]), []);
});

// Deliberately literal, not `SITTING_AFTER_HOURS - 1`. Written against the
// constant these pass under any threshold, which is no test at all.
test("nothing under a day old is reported", () => {
  assert.deepEqual(run([inbound({ date: ago(23) })]), []);
});

test("a day old counts as sitting", () => {
  assert.equal(run([inbound({ date: ago(24) })]).length, 1);
});

test("the default threshold is a day", () => {
  assert.equal(SITTING_AFTER_HOURS, 24);
});

test("only the newest inbound leg starts the wait", () => {
  // They nudged yesterday. The wait is a day, not four.
  const [t] = run([
    inbound({ date: ago(96) }),
    inbound({ date: ago(30) }),
  ]);
  assert.equal(t.hoursWaiting, 30);
});

test("only the newest sent leg counts as his answer", () => {
  // An old reply of his must not clear a newer message from them.
  const [t] = run(
    [inbound({ date: ago(30) })],
    [outbound({ date: ago(100) }), outbound({ date: ago(80) })],
  );
  assert.equal(t.direction, "awaiting_you");
});

test("longest wait comes first", () => {
  const rows = run([
    inbound({ threadId: "t1", date: ago(30) }),
    inbound({ threadId: "t2", date: ago(120) }),
  ]);
  assert.deepEqual(rows.map((r) => r.threadId), ["t2", "t1"]);
});

test("a message with no threadId is dropped rather than grouped under empty", () => {
  assert.deepEqual(run([inbound({ threadId: "" })]), []);
});

test("an unparseable date is dropped rather than treated as the epoch", () => {
  // Date.parse("") is NaN; a NaN wait would sort to the top and be spoken.
  assert.deepEqual(run([inbound({ date: "not a date" })]), []);
});

test("an unparseable sent date does not silently clear a thread", () => {
  const [t] = run([inbound()], [outbound({ date: "" })]);
  assert.equal(t.direction, "awaiting_you");
});

test("the subject falls back rather than speaking an empty pair of quotes", () => {
  const [t] = run([inbound({ subject: "" })]);
  assert.equal(t.subject, "(no subject)");
});

// ---- Broadcasts. The first live run without this rule announced eighteen
// threads waiting on him and led with three database pipeline reports. Every
// header below was read off real messages in his inbox on 2026-08-13. ----

const bulk = (name: string) => ({ from: "Whoever", headers: [{ name, value: "x" }] });

test("List-Unsubscribe marks a broadcast", () => {
  assert.equal(isBroadcast(bulk("List-Unsubscribe")), true);
});

test("List-ID marks a broadcast", () => {
  assert.equal(isBroadcast(bulk("List-ID")), true);
});

test("Precedence marks a broadcast", () => {
  assert.equal(isBroadcast(bulk("Precedence")), true);
});

test("Auto-Submitted marks a broadcast", () => {
  // Slack's notifications set this and nothing else.
  assert.equal(isBroadcast(bulk("Auto-Submitted")), true);
});

test("header names match case-insensitively", () => {
  assert.equal(isBroadcast(bulk("list-unsubscribe")), true);
});

test("an ordinary header is not a broadcast marker", () => {
  assert.equal(isBroadcast(bulk("Return-Path")), false);
  assert.equal(isBroadcast(bulk("Subject")), false);
});

test("a person with no bulk headers is not a broadcast", () => {
  // David Parks, verified live: Return-Path and nothing else.
  assert.equal(
    isBroadcast({
      from: "David Parks",
      address: "David Parks <davidlparks1@gmail.com>",
      headers: [{ name: "Return-Path", value: "<davidlparks1@gmail.com>" }],
    }),
    false,
  );
});

test("missing headers are treated as not-bulk rather than bulk", () => {
  // Failing open matters: a shape change at Composio must not silently empty
  // the tool by marking every thread a broadcast.
  assert.equal(isBroadcast({ from: "Maggie Corry" }), false);
});

test("an address that cannot receive a reply is a broadcast", () => {
  assert.equal(isBroadcast({ address: "noreply@tritondigital.com" }), true);
  assert.equal(isBroadcast({ address: "Summerfest <no-reply@summerfest.com>" }), true);
  assert.equal(isBroadcast({ address: "do-not-reply@x.gov" }), true);
  assert.equal(isBroadcast({ address: "MAILER-DAEMON@x.com" }), true);
});

test("a real name that merely contains those letters is not a broadcast", () => {
  // The rule must not eat Norah Replogle, or anyone at repl.co.
  assert.equal(isBroadcast({ address: "Norah Replogle <norah@replogle.com>" }), false);
  // Trailing boundary: "noreply" has to end the local part, not start it.
  assert.equal(isBroadcast({ address: "noreplytoday@example.com" }), false);
  // Leading boundary: and it has to begin one, not sit inside a longer word.
  assert.equal(isBroadcast({ address: "casinoreply@example.com" }), false);
});

test("the broadcast test reads the address, not the stripped display name", () => {
  // `from` has already had `<no-reply@…>` cut off it by the time it lands here.
  assert.equal(
    isBroadcast({ from: "Summerfest Insider", address: "Summerfest Insider <no-reply@summerfest.com>" }),
    true,
  );
});

test("a broadcast never becomes a sitting thread", () => {
  assert.deepEqual(run([{ ...inbound(), headers: [{ name: "List-Unsubscribe" }] }]), []);
});

test("a broadcast on the SENT leg still clears the thread", () => {
  // The rule is inbound-only on purpose: dropping a sent leg would resurrect
  // an answered thread as an unanswered one, which is the worst outcome here.
  const [t] = run(
    [inbound()],
    [{ ...outbound(), headers: [{ name: "Auto-Submitted" }] }],
  );
  assert.equal(t.direction, "awaiting_them");
});

test("describeWait speaks days, not hours", () => {
  assert.equal(describeWait(48), "2 days now");
  assert.equal(describeWait(25), "a day now");
  assert.equal(describeWait(200), "over a week");
});

test("an empty inbox says so plainly instead of counting zero", () => {
  const said = speakSitting([]);
  assert.match(said, /Nothing sitting/);
  assert.doesNotMatch(said, /0 threads/);
});

test("the spoken line names who and how long", () => {
  const said = speakSitting(run([inbound()]));
  assert.match(said, /One thread is waiting on you/);
  assert.match(said, /Valeria/);
  assert.match(said, /Studio quote/);
  assert.match(said, /2 days now/);
});

test("the spoken line stops naming after three and counts the rest", () => {
  const said = speakSitting(
    run(
      [1, 2, 3, 4, 5].map((n) =>
        inbound({ threadId: `t${n}`, from: `Person${n}`, date: ago(30 + n) }),
      ),
    ),
  );
  assert.match(said, /5 threads are waiting on you/);
  assert.match(said, /and 2 more/);
  assert.doesNotMatch(said, /Person1\b/);
});

test("threads he is waiting on are a trailing clause, not the headline", () => {
  const said = speakSitting(run([inbound()], [outbound()]));
  assert.match(said, /Nothing waiting on you/);
  assert.match(said, /waiting on 1 other/);
});

test("the inbox query keeps the category filter that mutes the promotions", () => {
  // Dropping category:primary floods this with newsletters, which is the
  // failure mode the mute list was built for in the first place.
  assert.match(REPLY_ZERO_INBOX_BASE, /category:primary/);
  assert.match(REPLY_ZERO_INBOX_BASE, /in:inbox/);
});

test("both queries span the same window, or the join is lopsided", () => {
  // A sent window shorter than the inbox window would resurrect answered
  // threads at the far edge as unanswered ones.
  const window = (q: string) => q.match(/newer_than:(\d+d)/)?.[1];
  assert.equal(window(REPLY_ZERO_SENT_QUERY), window(REPLY_ZERO_INBOX_BASE));
});
