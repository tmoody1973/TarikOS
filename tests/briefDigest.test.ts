import { test } from "node:test";
import assert from "node:assert/strict";
import { briefDigest } from "../src/lib/briefDigest.ts";
import { MAX_REPLY } from "../src/lib/telegram.ts";

// The morning brief, as a text message.
//
// The brief already exists — a cron builds it every weekday and it lands on
// the Briefs page. This turns those sections into something readable on a
// phone before he has opened anything.
//
// Two things here are not cosmetic. A bare `<` anywhere rejects the ENTIRE
// Telegram message (see src/lib/telegram.ts), and none of this content is
// app-authored: headings come from tool labels, bodies from Gmail subjects,
// calendar titles and search snippets. So every interpolated value is escaped
// and only the tags this file writes are markup. And the whole thing has to
// fit one message — Telegram truncates at 4096 and MAX_REPLY slices at 3500,
// so a digest that overruns loses its tail mid-tag rather than gracefully.

const section = (heading: string, body: string) => ({ heading, body });

test("headings and bodies both survive into the message", () => {
  const out = briefDigest("Morning Brief — 2026-08-11", [
    section("Calendar", "- 9:00 AM · Standup"),
    section("Inbox", "- Grant decision — Sarah"),
  ]);
  assert.match(out, /Morning Brief/);
  assert.match(out, /Calendar/);
  assert.match(out, /Standup/);
  assert.match(out, /Inbox/);
  assert.match(out, /Grant decision/);
});

test("a bare < in any section is escaped, not passed through", () => {
  // This is the whole message, not just this section: Telegram answers
  // "can't parse entities" and sends nothing at all.
  const out = briefDigest("Brief", [section("Inbox", "budget < 5k, reply soon")]);
  assert.ok(!/[^&]<[^b/iaucspq]/.test(out.replace(/<\/?[biaucspq][^>]*>/g, "")), out);
  assert.match(out, /&lt; 5k/);
  assert.ok(!out.includes("< 5k"));
});

test("a < in a heading is escaped too", () => {
  const out = briefDigest("Brief", [section("a < b", "body")]);
  assert.match(out, /a &lt; b/);
  assert.ok(!out.includes("a < b"));
});

test("the title is escaped", () => {
  const out = briefDigest("Research: <script> — 2026-08-11", [
    section("Web", "hit"),
  ]);
  assert.ok(!out.includes("<script>"));
  assert.match(out, /&lt;script&gt;/);
});

test("an ampersand is escaped so it cannot open an entity", () => {
  const out = briefDigest("Brief", [section("Inbox", "R&D update")]);
  assert.match(out, /R&amp;D/);
});

test("only tags this module writes appear as markup", () => {
  const out = briefDigest("Brief", [section("Inbox", "<b>not mine</b>")]);
  // The section's own <b> must arrive as text, so the only real tags left
  // are the ones the digest authored.
  assert.match(out, /&lt;b&gt;not mine/);
  const tags = [...out.matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[1]);
  assert.ok(
    tags.every((t) => ["b", "i", "u", "s", "a", "code", "pre", "blockquote"].includes(t)),
    tags.join(","),
  );
});

test("it fits in one Telegram message even when the brief is enormous", () => {
  const huge = Array.from({ length: 40 }, (_, i) =>
    section(`Section ${i}`, "x".repeat(500)),
  );
  const out = briefDigest("Brief", huge);
  assert.ok(out.length <= MAX_REPLY, `${out.length} > ${MAX_REPLY}`);
});

test("an over-long brief drops whole sections, never half of one", () => {
  // The property that matters, and the one a plain .slice() fails: a section
  // that appears must appear COMPLETE. Counting tags is not enough — a naive
  // cut usually lands in the middle of a body, where the tags happen to
  // balance and the check passes while the message is still truncated
  // mid-sentence. Each body is given a unique end marker so a partial section
  // is detectable.
  // Short lines, so the per-line MAX_LINE shortening never eats the marker —
  // it is whole-section truncation being tested here, not line trimming.
  const huge = Array.from({ length: 40 }, (_, i) =>
    section(
      `Section ${i}`,
      `${Array.from({ length: 10 }, () => "y".repeat(40)).join("\n")}\nEND${i}`,
    ),
  );
  const out = briefDigest("Brief", huge);

  for (let i = 0; i < huge.length; i++) {
    if (out.includes(`Section ${i}</b>`)) {
      assert.ok(
        out.includes(`END${i}`),
        `Section ${i} was included but cut before its end`,
      );
    }
  }
  // And it did have to drop something, or this proves nothing.
  assert.ok(!out.includes("END39"), "expected the tail sections to be dropped");

  // What survives is a contiguous prefix. Skipping an over-long section and
  // resuming with a later one packs more in, but a brief with holes in it
  // reads as though sections are missing at random.
  const kept = huge.map((_, i) => out.includes(`Section ${i}</b>`));
  assert.equal(
    kept.indexOf(false),
    kept.lastIndexOf(true) + 1,
    "sections must be dropped from the end, leaving no gap",
  );

  const opens = (out.match(/<b>/g) ?? []).length;
  const closes = (out.match(/<\/b>/g) ?? []).length;
  assert.equal(opens, closes, out.slice(-120));
  assert.ok(!/<[^>]*$/.test(out), `dangling tag: ${out.slice(-60)}`);
  // A cut inside an escape sequence produces literal "&l" / "&a" in the text.
  assert.ok(!/&[a-z]{0,3}$/.test(out), `cut inside an entity: ${out.slice(-20)}`);
});

test("an over-long brief says it was trimmed rather than ending mid-thought", () => {
  const huge = Array.from({ length: 40 }, (_, i) =>
    section(`Section ${i}`, "z".repeat(500)),
  );
  assert.match(briefDigest("Brief", huge), /more on the dashboard|…/);
});

test("one oversized section stops the digest — it does not leave a hole", () => {
  // Uniform sections cannot tell "stop here" apart from "skip this one":
  // if nothing after the first oversized block would fit either, both
  // behave identically. A big section followed by small ones separates them.
  const small = (i: number) => section(`Small ${i}`, `- line ${i}`);
  const sections = [
    ...Array.from({ length: 3 }, (_, i) => small(i)),
    section("Huge", Array.from({ length: 60 }, () => "- " + "h".repeat(150)).join("\n")),
    ...Array.from({ length: 3 }, (_, i) => small(i + 10)),
  ];
  const out = briefDigest("Brief", sections);

  assert.match(out, /Small 0/);
  assert.ok(!out.includes("Huge"), "the oversized section should not fit");
  // The ones after it must not be pulled forward past the gap.
  for (const i of [10, 11, 12]) {
    assert.ok(!out.includes(`Small ${i}`), `Small ${i} jumped the dropped section`);
  }
});

test("a very long line is shortened so one snippet cannot fill the screen", () => {
  // Research snippets arrive at up to 220 characters and mail snippets at 140
  // (see convex/workflowLib.ts). Unshortened, a single hit is a wall of text
  // on a phone and crowds out the sections underneath it.
  const long = `- ${"w".repeat(400)}`;
  const out = briefDigest("Brief", [section("Web", long)]);
  const line = out.split("\n").find((l) => l.includes("www"))!;
  assert.ok(line.length < 400, `line not shortened: ${line.length}`);
  assert.match(line, /…$/);
});

test("a line that fits is left exactly alone", () => {
  const out = briefDigest("Brief", [section("Calendar", "- 9:00 AM · Standup")]);
  assert.match(out, /- 9:00 AM · Standup/);
  assert.ok(!out.includes("…"));
});

test("error sections are dropped — a phone brief is not a place to debug", () => {
  const out = briefDigest("Brief", [
    section("Calendar", "- 9:00 AM · Standup"),
    section("Inbox", "⚠️ Gmail token expired"),
  ]);
  assert.match(out, /Standup/);
  assert.ok(!out.includes("Gmail token expired"));
});

test("a brief where every section failed produces nothing to send", () => {
  // Better silence than a morning text that is only error text.
  assert.equal(briefDigest("Brief", [section("Inbox", "⚠️ broken")]), "");
  assert.equal(briefDigest("Brief", []), "");
});

test("empty-bodied sections are dropped, not printed as bare headings", () => {
  const out = briefDigest("Brief", [
    section("Calendar", "   "),
    section("Inbox", "- real"),
  ]);
  assert.ok(!out.includes("Calendar"));
  assert.match(out, /real/);
});

test("markdown link syntax becomes a real link, not literal brackets", () => {
  const out = briefDigest("Brief", [
    section("Web", "- [The headline](https://example.com/x) — the snippet"),
  ]);
  assert.match(out, /<a href="https:\/\/example\.com\/x">The headline<\/a>/);
  assert.ok(!out.includes("]("));
});

test("markdown bold becomes real bold, not literal asterisks", () => {
  // formatSection emits **subject** for any mail row it cannot link to a
  // thread, so this is the common case, not an edge one.
  const out = briefDigest("Brief", [
    section("Inbox", "- **Invoice 4471 overdue** — billing@vendor.com: due"),
  ]);
  assert.match(out, /<b>Invoice 4471 overdue<\/b>/);
  assert.ok(!out.includes("**"));
});

test("bold and links coexist on one line", () => {
  const out = briefDigest("Brief", [
    section("Inbox", "- **Urgent** — see [the thread](https://example.com/t)"),
  ]);
  assert.match(out, /<b>Urgent<\/b>/);
  assert.match(out, /<a href="https:\/\/example\.com\/t">the thread<\/a>/);
});

test("a < inside a bold subject is escaped like everything else", () => {
  // Bold is markup this file writes; its CONTENTS are still a mail subject.
  const out = briefDigest("Brief", [section("Inbox", "- **budget < 5k** — Sarah")]);
  assert.match(out, /<b>budget &lt; 5k<\/b>/);
  assert.ok(!out.includes("< 5k"));
});

test("two bold runs on one line stay separate", () => {
  // A greedy match bolds everything between the first and last marker,
  // swallowing the prose in the middle.
  const out = briefDigest("Brief", [section("Inbox", "- **one** then **two**")]);
  assert.match(out, /<b>one<\/b> then <b>two<\/b>/);
});

test("a lone pair of asterisks in prose is left as text", () => {
  // "2 * 3 * 4" must not become markup, and an unclosed ** is not bold.
  const out = briefDigest("Brief", [section("Note", "- rate is 2 * 3 and **open")]);
  assert.ok(!out.includes("<b>rate"), out);
  assert.match(out, /2 \* 3/);
});

test("a javascript: url is not turned into a link", () => {
  const out = briefDigest("Brief", [
    // eslint-disable-next-line no-script-url
    section("Web", "- [click](javascript:alert(1)) — x"),
  ]);
  assert.ok(!out.includes("javascript:"));
  assert.match(out, /click/);
});

test("the in-app mail sentinel host never becomes a phone link", () => {
  // tarikos.internal only resolves inside the app; on a phone it is a dead
  // link, so the subject stays as text.
  const out = briefDigest("Brief", [
    section("Inbox", "- [Grant decision](https://tarikos.internal/mail?thread=abc) — Sarah"),
  ]);
  assert.ok(!out.includes("tarikos.internal"));
  assert.match(out, /Grant decision/);
});

test("the lede opens the digest", () => {
  const out = briefDigest("Morning Brief", [{ heading: "Calendar", body: "- 10am standup" }],
    "Your 10am moved. Nothing else needs you.");
  assert.ok(
    out.indexOf("Your 10am moved") < out.indexOf("Calendar"),
    "the lede must come before the first section",
  );
});

test("the lede survives the Telegram cut", () => {
  // Blocks are dropped whole when the message is too long. The lede is the one
  // thing that must never be what gets dropped.
  const fat = Array.from({ length: 60 }, (_, i) => ({
    heading: `Section ${i}`,
    body: "x".repeat(300),
  }));
  const out = briefDigest("Morning Brief", fat, "Your 10am moved.");
  assert.match(out, /Your 10am moved/);
});

test("a lede with a stray angle bracket cannot break the message", () => {
  // A single bare < makes Telegram reject the WHOLE message.
  const out = briefDigest("Morning Brief", [{ heading: "A", body: "b" }], "5 < 6 & rising");
  assert.doesNotMatch(out, /[^&]< /);
  assert.match(out, /&lt; 6 &amp; rising/);
});

test("no lede is the same digest as before", () => {
  const sections = [{ heading: "Calendar", body: "- 10am standup" }];
  assert.equal(briefDigest("T", sections), briefDigest("T", sections, ""));
});
