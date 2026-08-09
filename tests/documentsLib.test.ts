import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkShareAccess,
  newShareSlug,
  SLUG_LENGTH,
} from "../src/lib/documentsLib.ts";

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
