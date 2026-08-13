import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedSender,
  authResults,
  describeInbox,
  countInbox,
  inboxAllowlist,
  unreadCount,
  isForwarded,
  parseAllowlist,
  pickReplyTarget,
  received,
  replySubject,
  shouldAutoReply,
  summarize,
  threadKey,
} from "../src/lib/agentmailLib.ts";

// Zola's inbox is a public front door: anyone who learns zola@tarikos.app can
// put text in front of her. These are the rules that decide what reaches her
// reasoning, and they are pure so they can be tested without a network — the
// same shape as smsAllowlist and telegramAllowlist.

// ------------------------------------------------------- the allowlist

test("an allowlisted sender is allowed", () => {
  assert.equal(allowedSender("tarik@radiomilwaukee.org", ["tarik@radiomilwaukee.org"]), true);
});

test("a sender nobody listed is not allowed", () => {
  assert.equal(allowedSender("stranger@example.com", ["tarik@radiomilwaukee.org"]), false);
});

test("the display-name form of an address still matches", () => {
  // AgentMail hands back a real From header, not a bare address.
  assert.equal(
    allowedSender("Tarik Moody <tarik@radiomilwaukee.org>", ["tarik@radiomilwaukee.org"]),
    true,
  );
});

test("case in an address does not decide access", () => {
  assert.equal(allowedSender("Tarik@RadioMilwaukee.org", ["tarik@radiomilwaukee.org"]), true);
});

test("an empty allowlist allows nobody", () => {
  // Fails closed. An unset allowlist in production must not turn the inbox
  // into an open line into her context.
  assert.equal(allowedSender("tarik@radiomilwaukee.org", []), false);
});

test("a suffix is not a match", () => {
  // notradiomilwaukee.org is a different domain that ends the same way.
  assert.equal(allowedSender("tarik@notradiomilwaukee.org", ["tarik@radiomilwaukee.org"]), false);
});

test("the allowlist is parsed from a comma-separated string", () => {
  assert.deepEqual(parseAllowlist(" A@x.com , b@y.com "), ["a@x.com", "b@y.com"]);
});

test("an unset allowlist parses to nothing rather than to everyone", () => {
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist(""), []);
});

// ------------------------------------------------------- the summary

test("a summary is built from preview, not from the body", () => {
  // The first real email into this inbox was 20.9 KB and roughly two percent
  // of it was content: one line, then a signature block with phone numbers,
  // social links and a playlist. AgentMail's own preview cuts at the signature
  // boundary. Summarising `text` summarises the signature.
  const signature = "\n--\nTarik Moody\nphone, socials, a playlist, ".repeat(200);
  const summary = summarize({
    from: "Ken <ken@example.com>",
    subject: "Studio time Thursday",
    preview: "Can we move Thursday's session to four?",
    text: `Can we move Thursday's session to four?${signature}`,
  });
  assert.match(summary, /move Thursday's session to four/);
  assert.doesNotMatch(summary, /playlist/, "the signature block must not reach the summary");
});

test("a message with no preview falls back to its body", () => {
  const summary = summarize({
    from: "Ken <ken@example.com>",
    subject: "Studio time",
    text: "Can we move Thursday?",
  });
  assert.match(summary, /Can we move Thursday\?/);
});

test("a summary names who it is from and what it is about", () => {
  const summary = summarize({
    from: "Ken <ken@example.com>",
    subject: "Studio time Thursday",
    preview: "Can we move to four?",
  });
  assert.match(summary, /ken@example\.com/);
  assert.match(summary, /Studio time Thursday/);
});

test("a summary is never the whole message", () => {
  const summary = summarize({
    from: "a@b.com",
    subject: "Long one",
    preview: "x".repeat(5000),
  });
  assert.ok(summary.length < 400, `summary was ${summary.length} chars`);
});

// ------------------------------------------------------- forwards

test("a forwarded subject is recognised", () => {
  assert.equal(isForwarded({ from: "t@x.com", subject: "Fwd: Studio time" }), true);
  assert.equal(isForwarded({ from: "t@x.com", subject: "FW: Studio time" }), true);
  assert.equal(isForwarded({ from: "t@x.com", subject: "fwd: studio time" }), true);
});

test("an ordinary subject is not a forward", () => {
  assert.equal(isForwarded({ from: "t@x.com", subject: "Studio time" }), false);
  // A reply is not a forward. It is his own thread coming back.
  assert.equal(isForwarded({ from: "t@x.com", subject: "Re: Studio time" }), false);
});

test("a forwarded body is recognised without a forwarded subject", () => {
  assert.equal(
    isForwarded({
      from: "t@x.com",
      subject: "have a look",
      text: "thoughts?\n\n---------- Forwarded message ---------\nFrom: Ken <ken@x.com>",
    }),
    true,
  );
});

// ------------------------------------------------------- threads

test("a thread is keyed by its thread id when there is one", () => {
  assert.equal(threadKey({ from: "a@b.com", subject: "Hi", thread_id: "thr_123" }), "thr_123");
});

test("without a thread id, a normalised subject keys the thread", () => {
  // So a reply and its original land together rather than as two threads.
  assert.equal(
    threadKey({ from: "a@b.com", subject: "Re: Studio time" }),
    threadKey({ from: "a@b.com", subject: "Studio time" }),
  );
});

test("a subjectless message still gets a key", () => {
  assert.ok(threadKey({ from: "a@b.com" }).length > 0);
});

// ------------------------------------------------------- what she says

const TARIK = ["tarik@radiomilwaukee.org"];
const FROM_TARIK = {
  from: "Tarik Moody <tarik@radiomilwaukee.org>",
  subject: "Fwd: Studio time Thursday",
  preview: "Can we move Thursday's session to four?",
};
const FROM_STRANGER = {
  from: "noreply@someservice.com",
  subject: "Your booking is confirmed",
  preview: "Confirmation 8817 for Friday at seven.",
};

test("an empty inbox says so rather than saying nothing", () => {
  assert.match(describeInbox([], TARIK).message, /nothing|empty|no new/i);
});

test("an allowlisted message is summarised out loud", () => {
  const said = describeInbox([FROM_TARIK], TARIK);
  assert.equal(said.shown.length, 1);
  assert.match(said.message, /move Thursday's session to four/);
});

test("an unlisted sender is counted, never summarised", () => {
  const said = describeInbox([FROM_STRANGER], TARIK);
  assert.equal(said.shown.length, 0);
  assert.equal(said.withheld, 1);
  assert.doesNotMatch(
    said.message,
    /Confirmation 8817/,
    "an unlisted sender must not reach her reasoning context on its own",
  );
});

test("an unlisted sender is still there when he asks for it by name", () => {
  // The refinement the first draft of the spec got wrong: a confirmation from
  // a service she signed up with arrives from a sender nobody listed. It is
  // stored and readable — it just never volunteers itself.
  const said = describeInbox([FROM_STRANGER], TARIK, "someservice");
  assert.equal(said.shown.length, 1);
  assert.match(said.message, /Confirmation 8817/);
});

test("a forward is marked as forwarded", () => {
  // Because a forward grants attention, not authority: what it says is what
  // the email said, never what she was told to do.
  assert.match(describeInbox([FROM_TARIK], TARIK).message, /forwarded/i);
});

test("what an email said is quoted as what an email said", () => {
  const said = describeInbox([FROM_TARIK], TARIK);
  assert.match(said.message, /"|said|says/i);
});

// ------------------------------------------------------- who is on the list

test("the owner is on the allowlist without being configured twice", () => {
  // OWNER_EMAIL already names him everywhere else in the system. Making him
  // retype it into a second variable is a way to end up with an inbox that
  // ignores its owner.
  assert.deepEqual(inboxAllowlist("tarik@radiomilwaukee.org", undefined), [
    "tarik@radiomilwaukee.org",
  ]);
});

test("extra allowlisted senders join the owner", () => {
  assert.deepEqual(inboxAllowlist("t@x.com", "a@y.com, b@z.com"), [
    "t@x.com",
    "a@y.com",
    "b@z.com",
  ]);
});

test("no owner and no extras is a closed door", () => {
  assert.deepEqual(inboxAllowlist(undefined, undefined), []);
});

test("a preview that runs into the signature is cut at the separator", () => {
  // Measured against the real message: 20,891 bytes, of which one line was
  // content. AgentMail's preview is a fixed-length cut, not a semantic one, so
  // it runs past "-- " into the signature. Without this, every summary of a
  // real email ends in a job title.
  const summary = summarize({
    from: "Tarik Moody <tarikjmoody@gmail.com>",
    subject: "test",
    preview:
      "Hello, Zola. I hope you are doing well.\n\n-- \n\n[image: photo]\n" +
      "Tarik Jelani Moody\nDigital Director & Music Host at 88Nine Radio Milw",
  });
  assert.match(summary, /Hello, Zola\. I hope you are doing well\./);
  assert.doesNotMatch(summary, /Digital Director/);
});

test("a message that never signs off keeps all of its preview", () => {
  const summary = summarize({ from: "a@b.com", subject: "s", preview: "no signature here" });
  assert.match(summary, /no signature here/);
});

test("asking for something that is not there does not claim the inbox is empty", () => {
  // Found live: he asks "did the booking confirmation come in?", nothing
  // matches, and she answers "nothing new in your inbox" — which is false, and
  // is the one answer that would stop him looking.
  const said = describeInbox([FROM_STRANGER], TARIK, "the booking from Delta");
  assert.doesNotMatch(said.message, /nothing new in your inbox/i);
  assert.match(said.message, /nothing.*match|no.*match/i);
});

test("she counts one message in the singular, because she says it out loud", () => {
  const one = describeInbox([FROM_STRANGER], TARIK, "nothing like this").message;
  assert.match(one, /there is 1 other message\b/);
  const two = describeInbox([FROM_STRANGER, FROM_TARIK], TARIK, "nothing like this").message;
  assert.match(two, /there are 2 other messages\b/);
});

// ------------------------------------------------------- the tab and the brief

test("unread is counted from AgentMail's own label", () => {
  assert.equal(
    unreadCount([
      { ...FROM_TARIK, labels: ["received", "unread"] },
      { ...FROM_STRANGER, labels: ["received"] },
    ]),
    1,
  );
});

test("a message with no labels is not counted as unread", () => {
  assert.equal(unreadCount([FROM_TARIK]), 0);
});

test("the brief gets a count, never the content", () => {
  // Settled in the design: her inbox surfaces to him in the morning brief as
  // "two things arrived", not as what they said. A brief is generated
  // unattended, so nothing a stranger wrote should end up inside one.
  const line = countInbox([FROM_TARIK, FROM_STRANGER], TARIK);
  assert.match(line, /2/);
  assert.doesNotMatch(line, /Thursday|Confirmation/);
});

test("an empty inbox is a sentence, not a zero", () => {
  assert.match(countInbox([], TARIK), /nothing|no mail/i);
});

test("the count distinguishes the listed from the rest", () => {
  const line = countInbox([FROM_TARIK, FROM_STRANGER], TARIK);
  assert.match(line, /1 from someone on your list|1 from a sender on your list/i);
});

test("her own sent mail is not mail that arrived", () => {
  // Caught on screen: the reminder she emailed Tarik came back in her own
  // inbox list, so "two messages arrived" counted one she had written herself.
  // AgentMail labels both directions; only `received` is arrival.
  const inbox = received([
    { from: "Zola <zola@tarikos.app>", subject: "Reminder", labels: ["sent"] },
    { ...FROM_TARIK, labels: ["received", "unread"] },
  ]);
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].from, /tarik/i);
});

test("a message with no labels at all is treated as arrived", () => {
  // Fails open in the harmless direction: showing something that turns out to
  // be sent is a cosmetic wrong, hiding something that arrived is a lost email.
  assert.equal(received([{ from: "a@b.com", subject: "s" }]).length, 1);
});

// ------------------------------------------------ the letter to a stranger

const STRANGER = {
  from: "Curious Person <curious@example.com>",
  subject: "what is this",
  preview: "Saw your address in a talk. What is Zola?",
  labels: ["received"],
};
const VERIFIED = { dkim: "pass", spf: "pass" };

test("a verified stranger gets one reply", () => {
  assert.equal(shouldAutoReply(STRANGER, VERIFIED, TARIK, false).ok, true);
});

test("a sender who has already had one never gets another", () => {
  // Once per SENDER, not per message. Two auto-responders pointed at each other
  // is a mail loop that only stops when someone's provider blocks someone.
  const said = shouldAutoReply(STRANGER, VERIFIED, TARIK, true);
  assert.equal(said.ok, false);
  assert.match(said.reason, /already/i);
});

test("an unverified sender gets nothing", () => {
  // A From header is forgeable. Replying to a spoofed sender means mailing a
  // stranger unsolicited AI text from Tarik's own domain, on demand, as often
  // as the attacker likes. DKIM is what stops this being a spam cannon.
  const said = shouldAutoReply(STRANGER, { dkim: "fail", spf: "pass" }, TARIK, false);
  assert.equal(said.ok, false);
  assert.match(said.reason, /dkim|verif/i);
});

test("a missing DKIM result is treated as a failure", () => {
  assert.equal(shouldAutoReply(STRANGER, {}, TARIK, false).ok, false);
});

test("nobody on the allowlist gets the explainer", () => {
  const said = shouldAutoReply({ ...STRANGER, from: TARIK[0] }, VERIFIED, TARIK, false);
  assert.equal(said.ok, false);
  assert.match(said.reason, /allowlist/i);
});

test("no-reply and bulk senders are left alone", () => {
  // Replying to a mailing list is how a domain gets blocked.
  for (const from of ["no-reply@x.com", "noreply@x.com", "bounce+1@x.com", "mailer-daemon@x.com"]) {
    assert.equal(shouldAutoReply({ ...STRANGER, from }, VERIFIED, TARIK, false).ok, false, from);
  }
});

test("an automated message is left alone even from a normal address", () => {
  const auto = { ...STRANGER, headers: { "auto-submitted": "auto-generated" } };
  assert.equal(shouldAutoReply(auto, VERIFIED, TARIK, false).ok, false);
  const bulk = { ...STRANGER, headers: { precedence: "bulk" } };
  assert.equal(shouldAutoReply(bulk, VERIFIED, TARIK, false).ok, false);
  const list = { ...STRANGER, headers: { "list-unsubscribe": "<mailto:x@y.com>" } };
  assert.equal(shouldAutoReply(list, VERIFIED, TARIK, false).ok, false);
});

test("her own address never triggers a reply to itself", () => {
  const self = { ...STRANGER, from: "Zola <zola@tarikos.app>" };
  assert.equal(shouldAutoReply(self, VERIFIED, TARIK, false).ok, false);
});

// -------------------------------------------- reading the verdict off the wire

test("DKIM and SPF are parsed out of the Authentication-Results header", () => {
  // AgentMail reports no dkim field of its own — the verdict is buried in a
  // header string. Reading it from a field that does not exist would have made
  // every stranger fail the gate, and the letter would simply never have been
  // sent by anybody. Found before shipping, from a real message.
  const real =
    "amazonses.com; spf=pass (spfCheck: domain of _spf.google.com designates " +
    "209.85.208.42 as permitted sender) client-ip=209.85.208.42; " +
    "envelope-from=tarikjmoody@gmail.com; helo=mail-ed1-f42.google.com; " +
    "dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com;";
  assert.deepEqual(authResults({ "Authentication-Results": real }), {
    dkim: "pass",
    spf: "pass",
  });
});

test("a failing verdict is read as failing", () => {
  const failed = "amazonses.com; spf=softfail; dkim=fail header.i=@spoof.com;";
  assert.deepEqual(authResults({ "Authentication-Results": failed }), {
    dkim: "fail",
    spf: "softfail",
  });
});

test("a header that is missing entirely yields nothing, not a pass", () => {
  assert.deepEqual(authResults({}), {});
  assert.deepEqual(authResults(undefined), {});
});

test("the header name is matched whatever its casing", () => {
  const r = authResults({ "authentication-results": "x; dkim=pass; spf=pass;" });
  assert.equal(r.dkim, "pass");
});

test("a verified real message would earn the letter", () => {
  // The whole gate, end to end, against the header a real Gmail actually sent.
  const real = "amazonses.com; spf=pass; dkim=pass header.i=@gmail.com; dmarc=pass;";
  const decision = shouldAutoReply(STRANGER, authResults({ "Authentication-Results": real }), TARIK, false);
  assert.equal(decision.ok, true);
});

// ------------------------------------------------------- picking what to answer

// The recipient of a reply is never a choice. It is lifted off the envelope of
// a message that already arrived, which is what makes "a forwarded thread
// replies through Gmail" structural rather than a sentence in a prompt: a
// forward arrives FROM Tarik, so a reply to it goes TO Tarik, and reaching the
// original correspondent is impossible by construction.

const INBOX: Parameters<typeof pickReplyTarget>[0] = [
  {
    from: "Dana Booker <dana@venue.example>",
    subject: "Re: studio session",
    message_id: "<dana-2@venue.example>",
    thread_id: "t-dana",
    labels: ["received"],
  },
  {
    from: "Zola <zola@tarikos.app>",
    subject: "Re: studio session",
    message_id: "<zola-1@tarikos.app>",
    thread_id: "t-dana",
    labels: ["sent"],
  },
  {
    from: "Dana Booker <dana@venue.example>",
    subject: "studio session",
    message_id: "<dana-1@venue.example>",
    thread_id: "t-dana",
    labels: ["received"],
  },
  {
    from: "Reggie <reggie@label.example>",
    subject: "press kit",
    message_id: "<reggie-1@label.example>",
    thread_id: "t-reggie",
    labels: ["received"],
  },
];

test("nothing matching is nothing to answer", () => {
  assert.deepEqual(pickReplyTarget(INBOX, "somebody who never wrote"), {
    outcome: "none",
  });
});

test("a match across two conversations is ambiguous, not a guess", () => {
  const picked = pickReplyTarget(INBOX, "e");
  assert.equal(picked.outcome, "ambiguous");
  assert.equal(picked.outcome === "ambiguous" && picked.candidates.length, 2);
});

test("one conversation resolves to its newest message", () => {
  const picked = pickReplyTarget(INBOX, "dana");
  assert.equal(picked.outcome, "resolved");
  assert.equal(picked.outcome === "resolved" && picked.inReplyTo, "<dana-2@venue.example>");
});

test("the recipient is the bare address off the envelope", () => {
  const picked = pickReplyTarget(INBOX, "studio session");
  assert.equal(picked.outcome === "resolved" && picked.to, "dana@venue.example");
});

test("her own sent mail is never a reply target", () => {
  // AgentMail returns both directions, so her outgoing reply to Dana is sitting
  // in the same list. Answering it would have her write to herself.
  const picked = pickReplyTarget(INBOX, "zola@tarikos.app");
  assert.deepEqual(picked, { outcome: "none" });
});

test("the subject is the one being answered, prefixed once", () => {
  const picked = pickReplyTarget(INBOX, "reggie");
  assert.equal(picked.outcome === "resolved" && picked.subject, "Re: press kit");
});

test("Re is not stacked on a subject that already carries it", () => {
  assert.equal(replySubject("Re: studio session"), "Re: studio session");
  assert.equal(replySubject("RE: studio session"), "RE: studio session");
  assert.equal(replySubject("studio session"), "Re: studio session");
});

test("a message with no subject still gets an answerable one", () => {
  assert.equal(replySubject(undefined), "Re: (no subject)");
});
