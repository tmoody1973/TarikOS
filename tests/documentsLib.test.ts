import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkShareAccess,
  newShareSlug,
  SLUG_LENGTH,
} from "../convex/documentsLib.ts";

// /f/<slug> answers without a Clerk session. There is no cookie to check, no
// rate limit, and nobody to throttle — so the slug plus these four checks ARE
// the access control. Everything here is the security boundary, not helper
// logic around it.

const NOW = Date.parse("2026-08-09T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function link(over: Partial<Parameters<typeof checkShareAccess>[0]> = {}) {
  return {
    slug: "abcdefghijklmnopqrstuvwx",
    expiresAt: NOW + 7 * DAY,
    maxDownloads: undefined,
    downloadCount: 0,
    revoked: false,
    ...over,
  };
}

test("a fresh, unrevoked, unexpired link is allowed", () => {
  assert.deepEqual(checkShareAccess(link(), NOW), { allowed: true });
});

test("this module imports nothing from Node — it has to run in the isolate", () => {
  // The only structural test in this file, and it earns its place: every test
  // here runs in Node, where `node:crypto` works perfectly. Reintroduce
  // `randomBytes` or `timingSafeEqual` and all 22 tests still pass — then the
  // Convex mutation that shares this file dies in production, at runtime, on
  // an import the build never questioned.
  const src = readFileSync(
    new URL("../convex/documentsLib.ts", import.meta.url),
    "utf8",
  );
  const imports = src.match(/^import .*$/gm) ?? [];
  assert.deepEqual(imports, [], "convex/documentsLib.ts must stay import-free");
  assert.doesNotMatch(
    src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
    /\bBuffer\b|\brequire\(/,
    "no Node globals either — comments explaining the ban are fine",
  );
});

test("slugs are long enough that guessing is pointless", () => {
  // No rate limit and no session on /f/<slug>: length is the only cost an
  // attacker pays. 24 url-safe chars is ~143 bits.
  assert.ok(SLUG_LENGTH >= 24, "slug must be at least 24 characters");
  assert.equal(newShareSlug().length, SLUG_LENGTH);
});

test("slugs are url-safe — no padding, no slashes, nothing to escape", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(newShareSlug(), /^[A-Za-z0-9_-]+$/);
  }
});

test("slugs do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(newShareSlug());
  assert.equal(seen.size, 2000, "every generated slug must be distinct");
});

test("every symbol in the alphabet is reachable — no silent bias", () => {
  // Slugs are built by masking a random byte into a 64-symbol alphabet, which
  // is only unbiased because 256 divides evenly by 64. Swap the mask for a
  // modulo by 63 and the last symbol becomes unreachable while every other
  // test still passes: right length, right charset, still unique.
  //
  // Across 2000 slugs that is 48,000 symbols. A reachable symbol going unseen
  // has probability (63/64)^48000 — small enough that this is a deterministic
  // test, not a flaky one.
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) for (const ch of newShareSlug()) seen.add(ch);
  assert.equal(seen.size, 64, `expected all 64 symbols, saw ${seen.size}`);
});

test("a revoked link is denied", () => {
  const v = checkShareAccess(link({ revoked: true }), NOW);
  assert.equal(v.allowed, false);
  assert.deepEqual(v.allowed === false && v.reasons, ["revoked"]);
});

test("an expired link is denied", () => {
  const v = checkShareAccess(link({ expiresAt: NOW - 1 }), NOW);
  assert.equal(v.allowed, false);
  assert.deepEqual(v.allowed === false && v.reasons, ["expired"]);
});

test("expiry is inclusive — a link is dead at its own expiresAt", () => {
  const v = checkShareAccess(link({ expiresAt: NOW }), NOW);
  assert.equal(v.allowed, false, "expiresAt === now must already be expired");
});

test("a link with no expiry never expires", () => {
  const v = checkShareAccess(link({ expiresAt: undefined }), NOW + 3650 * DAY);
  assert.deepEqual(v, { allowed: true });
});

test("a link at its download cap is denied", () => {
  const v = checkShareAccess(link({ maxDownloads: 3, downloadCount: 3 }), NOW);
  assert.equal(v.allowed, false);
  assert.deepEqual(v.allowed === false && v.reasons, ["download_cap"]);
});

test("one download below the cap is still allowed", () => {
  const v = checkShareAccess(link({ maxDownloads: 3, downloadCount: 2 }), NOW);
  assert.deepEqual(v, { allowed: true });
});

test("a link with no cap is not capped", () => {
  const v = checkShareAccess(
    link({ maxDownloads: undefined, downloadCount: 9999 }),
    NOW,
  );
  assert.deepEqual(v, { allowed: true });
});

test("expired AND revoked reports both — not whichever an if/else hit first", () => {
  // The trap this test exists for: a naive if/else-if chain returns one reason
  // and hides the other, so a link that was revoked reads in the logs as
  // merely expired. Reasons are collected, not raced.
  const v = checkShareAccess(link({ revoked: true, expiresAt: NOW - 1 }), NOW);
  assert.equal(v.allowed, false);
  assert.deepEqual(
    v.allowed === false && [...v.reasons].sort(),
    ["expired", "revoked"],
  );
});

test("all three failures at once report all three", () => {
  const v = checkShareAccess(
    link({
      revoked: true,
      expiresAt: NOW - 1,
      maxDownloads: 1,
      downloadCount: 5,
    }),
    NOW,
  );
  assert.equal(v.allowed, false);
  assert.deepEqual(
    v.allowed === false && [...v.reasons].sort(),
    ["download_cap", "expired", "revoked"],
  );
});
