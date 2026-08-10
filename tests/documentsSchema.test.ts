import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Two fields in this schema fail *open* if they are ever made optional.
//
// `documentShareLinks.revoked` and `documentShareConfirmations.used` are both
// read as plain booleans by documentsLib. An `v.optional(v.boolean())` would
// let a row exist with the field undefined — which reads as falsy, which reads
// as "not revoked" and "not yet used". A revoked link would start working
// again and a spent confirmation could be replayed, with nothing failing
// loudly at any point.
//
// So these are pinned structurally, the way callGuardrails pins the absence of
// a destination parameter. Blocks are sliced on real boundaries — the
// `defineTable({` opener and the `})` that closes it — not character offsets.

const schema = readFileSync(
  new URL("../convex/schema.ts", import.meta.url),
  "utf8",
);

function table(name: string): string {
  const start = schema.indexOf(`${name}: defineTable({`);
  assert.ok(start > -1, `${name} must exist in convex/schema.ts`);
  const end = schema.indexOf("\n  })", start);
  assert.ok(end > start, `${name} must have a closing brace`);
  const block = schema.slice(start, end);
  assert.ok(block.length > 40, `${name} block sliced empty — fix the slice`);
  return block;
}

test("documents stores a pointer to R2, never the bytes", () => {
  const t = table("documents");
  assert.match(t, /objectKey: v\.string\(\)/, "must reference an R2 object key");
  assert.doesNotMatch(t, /\bv\.bytes\(/, "file contents belong in R2, not Convex");
});

test("a share link is found by slug — the public route has nothing else", () => {
  assert.match(
    schema,
    /documentShareLinks: defineTable\({[\s\S]*?}\)\.index\("by_slug", \["slug"\]\)/,
    "/f/[slug] looks up by slug and needs that index",
  );
});

test("revoked is required — an optional boolean would un-revoke every link", () => {
  const t = table("documentShareLinks");
  assert.match(t, /revoked: v\.boolean\(\)/);
  assert.doesNotMatch(
    t,
    /revoked: v\.optional/,
    "undefined reads as falsy, which reads as 'not revoked'",
  );
});

test("used is required — an optional boolean would make tokens replayable", () => {
  const t = table("documentShareConfirmations");
  assert.match(t, /used: v\.boolean\(\)/);
  assert.doesNotMatch(
    t,
    /used: v\.optional/,
    "undefined reads as falsy, which reads as 'not yet spent'",
  );
});

test("a confirmation is bound to a document and carries an expiry", () => {
  const t = table("documentShareConfirmations");
  assert.match(t, /documentId: v\.id\("documents"\)/, "bound to one document");
  assert.match(t, /expiresAt: v\.number\(\)/, "expiry is required, not optional");
});

test("confirmations are looked up by token", () => {
  assert.match(
    schema,
    /documentShareConfirmations: defineTable\({[\s\S]*?}\)\.index\("by_token", \["token"\]\)/,
  );
});
