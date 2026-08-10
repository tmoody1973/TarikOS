import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// `/f/<slug>` is the only route in Tarik OS that answers with no Clerk
// session. There is no cookie to check and nothing to rate-limit against, so
// the slug plus the checks in documentsLib are not part of the access
// control — they are all of it.
//
// What's behind these links is briefs, research, and journal digests: mail
// summaries and personal reflection. So the failure modes ARE the security
// surface, and they're pinned here by source-scan, the same species as
// callGuardrails and documentShareGuardrail.

const route = readFileSync(
  new URL("../src/app/f/[slug]/route.ts", import.meta.url),
  "utf8",
);
const proxy = readFileSync(
  new URL("../src/proxy.ts", import.meta.url),
  "utf8",
);
const documents = readFileSync(
  new URL("../convex/documents.ts", import.meta.url),
  "utf8",
);

function convexFn(name: string): string {
  const start = documents.indexOf(`export const ${name} = mutation({`);
  assert.ok(start > -1, `${name} must exist in convex/documents.ts`);
  const next = documents.indexOf("\nexport const ", start + 1);
  const body = documents.slice(start, next > -1 ? next : documents.length);
  assert.ok(body.length > 80, `${name} sliced empty — fix the slice`);
  return body;
}

test("/f is exempt from Clerk, deliberately and visibly", () => {
  assert.match(
    proxy,
    /"\/f\(\.\*\)"|"\/f\/\(\.\*\)"/,
    "the public share route must be listed in isPublicRoute",
  );
});

test("every denial produces the identical response", () => {
  // Unknown slug, revoked, expired, cap-exceeded: one shape. A different
  // status or body for any of them tells a stranger which slugs exist.
  const statuses = route.match(/status:\s*(\d{3})/g) ?? [];
  const unique = [...new Set(statuses)];
  assert.deepEqual(
    unique,
    ["status: 404"],
    "404 must be the only status this route constructs",
  );
});

test("the denial body says nothing", () => {
  assert.ok(
    !/revoked|expired|download_cap|not found for|no such document/i.test(
      route.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""),
    ),
    "no denial reason may appear in anything the route can send",
  );
});

test("the presigned URL only ever leaves as a redirect", () => {
  assert.match(route, /redirect\(/, "success is a redirect");
  assert.ok(
    !/NextResponse\.json\([^)]*url/i.test(route),
    "a presigned URL in a JSON body outlives the redirect that should carry it",
  );
});

test("the presign window is fixed, never derived from the link's own expiry", () => {
  // A 90-day share link still hands out 5-minute URLs, so a copied redirect
  // target dies almost immediately while the link keeps working.
  // Pin the value, not the name. An earlier version matched the identifier,
  // so a mutation that changed 300 to a full day sailed past it.
  assert.match(
    route,
    /SHARE_PRESIGN_SECONDS = 300;/,
    "five minutes, as a literal — not a name that could mean anything",
  );
  assert.ok(
    !/getPresignedDownloadUrl\([^)]*expiresAt/.test(route),
    "the link's expiry must not become the URL's expiry",
  );
});

test("the resolver hands the route no reasons to leak", () => {
  const fn = convexFn("resolveShare");
  assert.match(fn, /checkShareAccess\(/, "the pure rules must be consulted");
  assert.ok(
    !/return\s*{[^}]*reasons/.test(fn),
    "denial reasons are for the server log, never for the caller",
  );
});

test("a denied visit does not count as a download", () => {
  const fn = convexFn("resolveShare");
  const check = fn.indexOf("checkShareAccess(");
  const bump = fn.search(/downloadCount:\s*\w+\.downloadCount\s*\+\s*1/);
  assert.ok(bump > -1, "a successful visit must increment the counter");
  assert.ok(
    bump > check,
    "incrementing before the check would let a revoked link burn the cap " +
      "and would log traffic as downloads that never happened",
  );
});

test("the resolver is not reachable without the tool secret", () => {
  // The route holds it; nothing else should be able to trade a guessed slug
  // for an object key straight against the Convex deployment.
  const fn = convexFn("resolveShare");
  assert.match(fn, /secret: v\.string\(\)/, "required, not optional");
  assert.match(fn, /checkToolSecret\(secret\)/);
});
