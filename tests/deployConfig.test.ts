import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// How this project ships.
//
// Guarded because it failed silently for a whole day: there was no Vercel git
// integration, so a push looked like a deploy and was not, and production sat
// on the old build while Convex was already migrated to the new schema. The
// tell was new tool routes 404ing against a database that already had their
// tables.
//
// Config, not logic — so this is a guard rather than a unit test. It exists
// because the failure mode is silence.

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  buildCommand?: string;
};

test("a production build deploys Convex before building the app", () => {
  const cmd = vercel.buildCommand ?? "";
  assert.ok(cmd, "vercel.json must set a build command");
  assert.match(cmd, /convex deploy/, "the schema must ship with the app");
  // `--cmd` is what makes the ORDER right: Convex deploys, then it runs the
  // frontend build with NEXT_PUBLIC_CONVEX_URL pointing at what it just
  // deployed. Two separate commands would let the app build against the old
  // deployment, which is the same split-brain in a smaller window.
  assert.match(cmd, /convex deploy --cmd/, "the app build must run INSIDE convex deploy");
});

test("a preview build never deploys Convex", () => {
  // CONVEX_DEPLOY_KEY is a PRODUCTION key. Convex targets whatever deployment
  // the key belongs to, branch be damned — so an unguarded build command would
  // let any feature branch overwrite the production schema.
  const cmd = vercel.buildCommand ?? "";
  assert.match(cmd, /VERCEL_ENV/, "the Convex deploy must be gated on the environment");
  const guarded = cmd.indexOf("VERCEL_ENV");
  const deploys = cmd.indexOf("convex deploy");
  assert.ok(guarded >= 0 && deploys >= 0, "both the guard and the deploy must exist");
  assert.ok(guarded < deploys, "the guard must come before the deploy it guards");
  // And the other branch still builds, or every preview deployment fails.
  const fallback = cmd.split("else")[1] ?? "";
  assert.match(fallback, /build/, "a preview build must still build the app");
  assert.doesNotMatch(fallback, /convex deploy/, "a preview must not deploy Convex");
});
