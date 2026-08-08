import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tripwire: the single-user gate must stay wired. The landing page made
// /sign-in publicly reachable, so this wall is now the thing standing between
// a stranger with a Clerk account and Tarik's dashboard.

const owner = readFileSync("src/lib/owner.ts", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");

test("root layout renders the wall for a non-owner session", () => {
  assert.match(layout, /isOwner\(\)/, "layout must call isOwner()");
  assert.match(
    layout,
    /isAuthenticated && !owner \? \(\s*<NotOwner \/>/,
    "layout must render NotOwner when authenticated but not the owner"
  );
});

test("owner check requires a verified email address", () => {
  // An unverified address is a claim, not proof — matching on it would let
  // anyone in by typing the owner's address at sign-up.
  assert.match(
    owner,
    /verification\?\.status === "verified"/,
    "owner match must require a verified email"
  );
});

test("owner check is case- and whitespace-insensitive on both sides", () => {
  const envSide = /process\.env\.OWNER_EMAIL\?\.trim\(\)\.toLowerCase\(\)/;
  const userSide = /e\.emailAddress\.trim\(\)\.toLowerCase\(\)/;
  assert.match(owner, envSide, "OWNER_EMAIL must be normalized");
  assert.match(owner, userSide, "the user's address must be normalized");
});

test("a signed-in user with no Clerk record is never treated as owner", () => {
  assert.match(
    owner,
    /if \(!user\) return false/,
    "a missing user record must fail closed"
  );
});
