import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONFIRMATION_TTL_MS,
  isConfirmationValid,
  newConfirmation,
} from "../convex/documentsLib.ts";

// Sharing is the only action in Tarik OS that puts content behind a URL which
// works with no Clerk session — and the sources are briefs, research, and
// journal digests, which carry mail summaries and personal reflection.
//
// The design assumed a "spoken-confirm ritual" already existed in the tool
// route. It does not: create_calendar_event validates arguments and writes.
// The only confirmation in the system is prompt text asking the agent to say a
// sentence first, and the tool-selection eval measured this model calling a
// tool on 12 of 58 turns where the right answer was to do nothing.
//
// So the gate is structural: no confirmation record, no share link. These
// tests are the tripwire, in the same family as callGuardrails.

const DOC = "doc_abc123";
const OTHER = "doc_zzz999";
const NOW = Date.parse("2026-08-09T18:00:00Z");

test("a fresh confirmation for the right document is valid", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(
    isConfirmationValid(c, { token: c.token, documentId: DOC, now: NOW }),
    true,
  );
});

test("no confirmation record at all is never valid", () => {
  // The default must be denial. A missing record is the shape an attacker —
  // or a model that skipped a step — produces.
  assert.equal(
    isConfirmationValid(undefined, {
      token: "anything",
      documentId: DOC,
      now: NOW,
    }),
    false,
  );
});

test("a token bound to one document cannot share another", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(
    isConfirmationValid(c, { token: c.token, documentId: OTHER, now: NOW }),
    false,
    "confirming one document must not authorize sharing a different one",
  );
});

test("the wrong token is rejected even for the right document", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(
    isConfirmationValid(c, {
      token: newConfirmation(DOC, NOW).token,
      documentId: DOC,
      now: NOW,
    }),
    false,
  );
});

test("a confirmation is single-use", () => {
  const c = newConfirmation(DOC, NOW);
  const used = { ...c, used: true };
  assert.equal(
    isConfirmationValid(used, { token: c.token, documentId: DOC, now: NOW }),
    false,
    "replaying a spent confirmation must not mint a second link",
  );
});

test("a confirmation expires", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(
    isConfirmationValid(c, {
      token: c.token,
      documentId: DOC,
      now: NOW + CONFIRMATION_TTL_MS + 1,
    }),
    false,
  );
});

test("the confirmation window is short — minutes, not hours", () => {
  // A long window means "yes" said once keeps authorizing shares later in the
  // conversation, which is the failure this gate exists to prevent.
  assert.ok(
    CONFIRMATION_TTL_MS <= 10 * 60 * 1000,
    "confirmation TTL must be 10 minutes or less",
  );
});

test("confirmation tokens do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(newConfirmation(DOC, NOW).token);
  assert.equal(seen.size, 2000);
});

test("a new confirmation starts unused and bound to its document", () => {
  const c = newConfirmation(DOC, NOW);
  assert.equal(c.used, false);
  assert.equal(c.documentId, DOC);
  assert.equal(c.expiresAt, NOW + CONFIRMATION_TTL_MS);
});

// ── The wiring ────────────────────────────────────────────────────────────
//
// The pure checks above only matter if every path to a share link runs
// through them. So the second half of this guardrail is structural: there is
// exactly ONE place in the repo that inserts a documentShareLinks row, it
// takes a confirmation token, and it spends that token before it writes.
//
// Source-scanned rather than executed, the same way callGuardrails pins the
// absence of a destination parameter — the property being defended is "no
// second way in", and no unit test of one function can assert that.

const documents = readFileSync(
  new URL("../convex/documents.ts", import.meta.url),
  "utf8",
);

/** Body of a Convex function, from its export to the next one. */
function convexFn(name: string): string {
  const start = documents.indexOf(`export const ${name} = mutation({`);
  assert.ok(start > -1, `${name} must exist in convex/documents.ts`);
  const next = documents.indexOf("\nexport const ", start + 1);
  const body = documents.slice(start, next > -1 ? next : documents.length);
  assert.ok(body.length > 80, `${name} sliced empty — fix the slice`);
  return body;
}

/** Every .ts/.tsx under the directories that can hold a Convex or route write. */
function sourceFiles(): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (const dir of ["convex", "src", "scripts"]) {
    const root = fileURLToPath(new URL(`../${dir}/`, import.meta.url));
    for (const rel of readdirSync(root, { recursive: true })) {
      const name = String(rel);
      if (!/\.tsx?$/.test(name)) continue;
      out.push({ label: `${dir}/${name}`, text: readFileSync(root + name, "utf8") });
    }
  }
  assert.ok(out.length > 50, "source walk found almost nothing — fix the walk");
  return out;
}

test("exactly one place in the repo can create a share link", () => {
  // Call sites, not files: a second insert inside documents.ts is just as
  // much a second door as one in a route, and an earlier version of this
  // test — which listed files — let exactly that through.
  const writers = sourceFiles().flatMap((f) =>
    (f.text.match(/insert\(\s*"documentShareLinks"/g) ?? []).map(
      () => f.label,
    ),
  );
  assert.deepEqual(
    writers,
    ["convex/documents.ts"],
    "a second writer would be a second way past the confirm gate",
  );
});

test("creating a link requires a confirmation token", () => {
  const fn = convexFn("createShareLink");
  assert.match(
    fn,
    /confirmationToken: v\.string\(\)/,
    "the token is required, not optional — optional means skippable",
  );
  assert.match(fn, /isConfirmationValid\(/, "the gate must be consulted");
});

test("the token is spent before the link is written", () => {
  const fn = convexFn("createShareLink");
  const spend = fn.search(/patch\([^)]*\{\s*used: true/);
  const write = fn.search(/insert\(\s*"documentShareLinks"/);
  assert.ok(spend > -1, "the confirmation must be marked used");
  assert.ok(write > -1, "createShareLink must write the link");
  assert.ok(
    spend < write,
    "spend first: a throw between write and spend would leave a live link " +
      "and a reusable token",
  );
});

test("an invalid confirmation throws rather than falling through", () => {
  const fn = convexFn("createShareLink");
  // Everything between consulting the gate and spending the token is the
  // denial branch. Its only exit may be a throw — a returned flag is
  // something a caller can ignore its way past.
  const gate = fn.indexOf("isConfirmationValid(");
  const spend = fn.indexOf("patch(");
  assert.ok(gate > -1 && spend > gate, "gate must be consulted before spending");
  const branch = fn.slice(gate, spend);
  assert.match(branch, /throw new Error/, "denial must throw");
  assert.ok(
    !/\breturn\b/.test(branch),
    "denial must not return a value the caller can shrug off",
  );
});

test("the slug is minted server-side, never taken from the caller", () => {
  const fn = convexFn("createShareLink");
  assert.match(fn, /slug\s*=\s*newShareSlug\(\)/);
  assert.doesNotMatch(
    fn,
    /slug: v\./,
    "a caller-supplied slug would let anyone guess or collide a link",
  );
});

test("phase one hands back a token and writes no link", () => {
  const fn = convexFn("requestShare");
  assert.match(fn, /insert\(\s*"documentShareConfirmations"/);
  assert.ok(
    !/insert\(\s*"documentShareLinks"/.test(fn),
    "asking for confirmation must not itself share anything",
  );
  assert.match(fn, /requiresConfirmation: true/);
});
