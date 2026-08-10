import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHARE_DAYS,
  buildDocumentFromBrief,
  buildDocumentFromJournal,
  buildDocumentFromResearch,
  objectKeyFor,
  shareExpiryFrom,
} from "../src/lib/documentBuilders.ts";

// v1 stores what the source already produces — markdown, no rendering
// pipeline. These are the pure half of save_document: what the file says, what
// it's called, and where in the bucket it lands. The R2 call around them is
// I/O and lives in r2.ts.

const NOW = Date.parse("2026-08-10T14:00:00Z");

test("a brief becomes markdown with its sections in order", () => {
  const doc = buildDocumentFromBrief(
    {
      title: "Morning Brief",
      sections: [
        { heading: "Calendar", body: "Two meetings." },
        { heading: "Mail", body: "Nothing urgent." },
      ],
    },
    NOW,
  );
  assert.match(doc.body, /^# Morning Brief/);
  assert.ok(
    doc.body.indexOf("## Calendar") < doc.body.indexOf("## Mail"),
    "sections keep the order the brief gave them",
  );
  assert.match(doc.body, /Two meetings\./);
  assert.equal(doc.contentType, "text/markdown");
  assert.match(doc.filename, /\.md$/);
});

test("a brief with no sections says so rather than arriving blank", () => {
  // Checking the body is merely non-empty proved nothing — the title and
  // date line alone satisfy that, and a mutation removing the explanation
  // survived. A file that opens to a bare heading reads as a failed save.
  const doc = buildDocumentFromBrief({ title: "Empty", sections: [] }, NOW);
  assert.match(doc.body, /# Empty/);
  assert.match(
    doc.body,
    /no sections/i,
    "the file must explain its own emptiness",
  );
});

test("research keeps every result's url — that's the whole point of saving it", () => {
  const doc = buildDocumentFromResearch(
    "convex isolates",
    [
      { title: "Docs", url: "https://example.com/a", snippet: "one" },
      { title: "Post", url: "https://example.com/b", snippet: "two" },
    ],
    NOW,
  );
  assert.match(doc.body, /https:\/\/example\.com\/a/);
  assert.match(doc.body, /https:\/\/example\.com\/b/);
  assert.match(doc.title, /convex isolates/);
});

test("a journal digest carries its own body through untouched", () => {
  const digest = "## Monday\nSlept badly.\n\n## Tuesday\nBetter.";
  const doc = buildDocumentFromJournal(digest, NOW);
  assert.ok(
    doc.body.includes(digest),
    "the digest is already rendered — do not re-render it",
  );
});

test("every builder dates its title, so a folder of them is readable", () => {
  for (const doc of [
    buildDocumentFromBrief({ title: "B", sections: [] }, NOW),
    buildDocumentFromResearch("q", [], NOW),
    buildDocumentFromJournal("d", NOW),
  ]) {
    assert.match(doc.filename, /2026-08-10/, "filename carries the date");
  }
});

test("an object key cannot escape its prefix", () => {
  // The key is attacker-adjacent: it's built from a title Zola heard out
  // loud. `..` or a leading slash in an S3 key is not a traversal in the
  // filesystem sense, but it does let one document's key collide with or
  // shadow another's, which is enough.
  const key = objectKeyFor("../../etc/passwd", "md", NOW);
  assert.ok(key.startsWith("documents/"), "everything lives under documents/");
  assert.ok(!key.includes(".."), "no parent-directory segments");
  assert.ok(!key.includes("//"), "no empty segments");
  assert.doesNotMatch(key, /^\//, "never absolute");
});

test("object keys do not collide for the same title", () => {
  const a = objectKeyFor("Morning Brief", "md", NOW);
  const b = objectKeyFor("Morning Brief", "md", NOW);
  assert.notEqual(a, b, "two saves of the same brief must not overwrite");
});

test("a title of nothing but punctuation still yields a usable key", () => {
  // Pinned to the exact shape. A looser character-class match accepted
  // `documents/2026-08-10--.md` — a key with an empty name segment — and a
  // mutation that removed the fallback walked past it.
  assert.match(
    objectKeyFor("???", "md", NOW),
    /^documents\/2026-08-10-document-[a-z0-9]+\.md$/,
    "an unusable title falls back to a named key, not an empty segment",
  );
});

test("a runaway title cannot produce a runaway key", () => {
  // S3 keys cap at 1024 bytes. A title is whatever Zola transcribed, and a
  // long dictation would otherwise fail at the R2 call rather than here.
  const key = objectKeyFor("word ".repeat(500), "md", NOW);
  assert.ok(key.length < 120, `key was ${key.length} chars`);
});

test("share links expire in seven days unless told otherwise", () => {
  assert.equal(DEFAULT_SHARE_DAYS, 7);
  assert.equal(
    shareExpiryFrom(undefined, NOW),
    NOW + 7 * 24 * 60 * 60 * 1000,
    "the default is an expiry, never forever",
  );
  assert.equal(shareExpiryFrom(30, NOW), NOW + 30 * 24 * 60 * 60 * 1000);
});

test("no expiry has to be asked for explicitly, and zero is not a request", () => {
  // "0 days" is a mis-heard number, not a decision to publish forever.
  assert.equal(shareExpiryFrom(0, NOW), NOW + 7 * 24 * 60 * 60 * 1000);
  assert.equal(shareExpiryFrom(-3, NOW), NOW + 7 * 24 * 60 * 60 * 1000);
  assert.equal(shareExpiryFrom("never", NOW), undefined, "spoken explicitly");
});

test("an absurd expiry is clamped rather than honoured", () => {
  const tenYears = shareExpiryFrom(3650, NOW);
  assert.ok(
    tenYears !== undefined && tenYears <= NOW + 366 * 24 * 60 * 60 * 1000,
    "a year is the ceiling for a number; longer means saying 'never'",
  );
});
