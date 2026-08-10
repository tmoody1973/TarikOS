import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// save_document, share_document and revoke_document_share, pinned at the
// route. The rules these enforce are the ones a prompt cannot be trusted with:
// saving must never publish, and the second phase of a share must spend a
// token the *caller* supplied rather than one the route minted a line earlier.

const route = readFileSync(
  new URL("../src/app/api/tools/[tool]/route.ts", import.meta.url),
  "utf8",
);
const provision = readFileSync(
  new URL("../scripts/provision-agent.ts", import.meta.url),
  "utf8",
);

/** One case arm, from its label to the next. */
function toolCase(name: string): string {
  const start = route.indexOf(`case "${name}"`);
  assert.ok(start > -1, `${name} must exist in the tool route`);
  const next = route.indexOf("\n    case ", start + 1);
  const body = route.slice(start, next > -1 ? next : route.length);
  assert.ok(body.length > 60, `${name} sliced empty — fix the slice`);
  return body;
}

test("saving never publishes", () => {
  // The whole reason save_document needs no confirm gate is that it stays
  // inside the Clerk boundary. The moment it can mint a link, that argument
  // is false and the gate has been bypassed by the tool that skips it.
  const fn = toolCase("save_document");
  assert.ok(
    !/createShareLink|documentShareLinks|requestShare/.test(fn),
    "save_document must have no path to a share link",
  );
});

test("share_document phase one writes nothing and stops", () => {
  const fn = toolCase("share_document");
  const ask = fn.indexOf("requestShare");
  const mint = fn.indexOf("createShareLink");
  assert.ok(ask > -1, "phase one must ask for confirmation");
  assert.ok(mint > -1, "phase two must mint the link");
  assert.match(
    fn.slice(ask, mint),
    /\breturn\b/,
    "phase one must return before phase two can run — otherwise the route " +
      "mints its own token and spends it, and the gate is theatre",
  );
});

test("the token spent comes from the caller, not from this request", () => {
  const fn = toolCase("share_document");
  const mint = fn.indexOf("createShareLink");
  const call = fn.slice(mint, mint + 400);
  assert.match(
    call,
    /confirmationToken:\s*(?:confirmation|token)\b/,
    "phase two spends a token read out of the request body",
  );
  assert.match(
    fn,
    /body\.confirmation_token|body\.confirmationToken/,
    "and that token must be read from the body",
  );
});

test("a refused confirmation is an answer, not an outage", () => {
  // The Convex mutation throws on every denial, and an uncaught throw in a
  // tool arm reaches the route's catch-all: a 500, "tell Tarik it needs
  // attention in the control panel", and reportToolError marking the tool
  // unhealthy. Observed live — an expired or replayed token would take
  // share_document down in the registry for a case that is working exactly
  // as designed.
  const fn = toolCase("share_document");
  assert.match(fn, /catch\b/, "the denial must be caught in this arm");
  assert.match(
    fn,
    /not confirmed/i,
    "and matched on the mutation's message rather than swallowing everything",
  );
  // Code only — the comment above this guard names reportToolError to explain
  // what it prevents, and scanning the raw text flagged the explanation.
  const code = fn.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !/reportToolError/.test(code),
    "a denial must never mark the tool unhealthy",
  );
});

test("a share expiry is never invented at the call site", () => {
  const fn = toolCase("share_document");
  assert.match(
    fn,
    /shareExpiryFrom\(/,
    "the seven-day default and the 'never' rule live in one function",
  );
});

test("revoking needs a target and calls the revoke mutation", () => {
  const fn = toolCase("revoke_document_share");
  assert.match(fn, /revokeShare/);
  // Merely mentioning the variables proved nothing — deleting the guard
  // entirely left that assertion passing. Pin the guard itself: with neither
  // a slug nor a document id, revokeShare would be handed two undefineds,
  // and "unshare it" with no target must ask rather than guess.
  assert.match(
    fn,
    /if\s*\(\s*!slug\s*&&\s*!documentId\s*\)\s*\{[\s\S]{0,120}?return\s*\{\s*ok:\s*false/,
    "revoke must refuse when it has no target",
  );
});

/**
 * One TOOLS entry, bounded by the next one.
 *
 * A fixed-length slice read into the *following* tool, so a missing secret
 * header was satisfied by the next entry's — the mutation sweep caught it.
 */
function toolEntry(name: string): string {
  const start = provision.indexOf(`name: "${name}"`);
  assert.ok(start > -1, `${name} must be registered in TOOLS`);
  const next = provision.indexOf(`name: "`, start + 1);
  const entry = provision.slice(start, next > -1 ? next : provision.length);
  assert.ok(entry.length > 100, `${name} entry sliced empty — fix the slice`);
  return entry;
}

test("all three tools are published to the agent with the secret header", () => {
  for (const name of [
    "save_document",
    "share_document",
    "revoke_document_share",
  ]) {
    assert.match(
      toolEntry(name),
      /x-morpheus-secret/,
      `${name} must carry the shared secret header`,
    );
  }
});

test("save_document's description says what makes it different", () => {
  // It sits next to capture_thought, remember and journal_entry, which all
  // already mean "save the thing he just said" (MOO-576). Without an explicit
  // discriminator the model picks by vibe, and the eval measured that going
  // wrong on 12 of 58 turns.
  const entry = toolEntry("save_document");
  const description = entry.slice(0, entry.indexOf("apiSchema"));
  assert.match(
    description,
    /file/i,
    "it must say it produces a file, which the others do not",
  );
  assert.match(
    description,
    /existing|already/i,
    "and that it works from an existing record, not from new speech",
  );
});

test("share_document's description tells the agent the call is two-phase", () => {
  const entry = toolEntry("share_document");
  // The properties block, not the prose. The description mentions
  // confirmation_token by name, so matching the whole entry passed even with
  // the parameter itself renamed — and an unpublished parameter means the
  // agent can never make the second call.
  const properties = entry.slice(entry.indexOf("properties:"));
  assert.match(
    properties,
    /confirmation_token: bodyProp\(/,
    "the token parameter has to be published or phase two is unreachable",
  );
});
