import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Zola's Studio tools, and the rules that make it safe to let her near his
// writing. All four are in the same shape as the contact tools: she resolves to
// exactly ONE thing or she asks, and she never picks.
//
// Comments are stripped before every scan — a guardrail in this repo passed
// three times while guarding nothing, because it matched the word it was
// looking for inside the comment explaining the guard.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const ROUTE = CODE("src/app/api/tools/[tool]/route.ts");
const TOOLS = CODE("convex/studioTools.ts");
const STUDIO = CODE("convex/studio.ts");
const PROVISION = readFileSync("scripts/provision-agent.ts", "utf8");
const SCHEMA = CODE("convex/schema.ts");

/** One `case "x": { … }` block from the tool route. */
const routeCase = (name: string) =>
  ROUTE.split(`case "${name}":`)[1]?.split("\n    case ")[0] ?? "";

/** One exported Convex function's body. */
const fnIn = (code: string, name: string) =>
  code.split(`export const ${name} =`)[1]?.split("\nexport const ")[0] ?? "";

const FOUR = [
  "find_studio_document",
  "read_studio_document",
  "write_studio_document",
  "propose_studio_edit",
];

// ------------------------------------------------------------ they exist

test("all four studio tools have a route", () => {
  for (const name of FOUR) {
    assert.ok(routeCase(name), `${name} has no case in the tool route`);
  }
});

test("all four studio tools are published to the agent", () => {
  // A route nothing calls is not a tool. The agent only has what the
  // provisioning script gives it.
  for (const name of FOUR) {
    assert.match(
      PROVISION,
      new RegExp(`name: "${name}"`),
      `${name} is not in the TOOLS list, so the agent cannot call it`,
    );
  }
});

test("every published studio tool posts to its own webhook", () => {
  for (const name of FOUR) {
    const def = PROVISION.split(`name: "${name}"`)[1]?.split("\n  },")[0] ?? "";
    assert.match(def, new RegExp(`/${name}\``), `${name} points at the wrong URL`);
    assert.match(def, /x-morpheus-secret/, `${name} is published without the shared secret`);
  }
});

// ------------------------------------------------------- she never picks

test("finding two documents reads both back rather than choosing", () => {
  // The rule find_contact learned from real data, and the reason this is not
  // simply "return the top hit".
  const body = routeCase("find_studio_document");
  assert.match(body, /length === 1/, "the one-match case must be distinguished");
  assert.match(body, /Which one\?|which one\?/, "two matches must end in a question");
});

test("reading a document refuses to guess which one was meant", () => {
  // Asserted on the branch, not on how "exactly one" is spelled: `=== 1` and
  // `!== 1` mean the same thing and a guardrail that insists on one of them
  // fails on a refactor that changed nothing.
  const body = routeCase("read_studio_document");
  // Cut at the branch's own closing brace, not at the first `}` — the message
  // is a template literal full of them, and splitting there stops before the
  // words this test exists to find.
  const ambiguous = body.split(/matches\.length (?:!==|>) 1/)[1]?.split("\n      }")[0] ?? "";
  assert.ok(ambiguous, "read does not handle several matching documents");
  assert.match(ambiguous, /which/i, "an ambiguous read must ask");
  assert.doesNotMatch(
    ambiguous,
    /studioTools\.read/,
    "an ambiguous read must not read one of them anyway",
  );
});

test("a quote matching two blocks asks which, and proposes nothing", () => {
  const body = routeCase("propose_studio_edit");
  // Cut at the branch's own closing brace. Splitting on the first `}` lands
  // inside the template literal, and every assertion after it would pass on a
  // string too short to contain what it forbids.
  const ambiguous = body.split("matches.length > 1")[1]?.split("\n      }")[0] ?? "";
  assert.ok(ambiguous.includes("Which one?"), "an ambiguous quote must end in a question");
  assert.doesNotMatch(
    ambiguous,
    /proposeRewrite|studioTools\.propose/,
    "an ambiguous quote must not produce a proposal",
  );
  // And the branch must LEAVE — falling through would reach the rewrite below
  // with the first of two candidates, which is picking.
  assert.match(ambiguous, /return \{/, "the ambiguous branch must return");
});

test("a quote matching nothing says so rather than proposing", () => {
  const body = routeCase("propose_studio_edit");
  assert.match(body, /matches\.length === 0/, "propose must handle a quote that matches nothing");
});

// ------------------------------------- she proposes; she never applies

test("the voice path cannot write into a document's content", () => {
  // THE rule. Voice cannot show a diff, so voice must not write. Every
  // patch of a studioDoc lives in studio.ts behind a Clerk session.
  assert.doesNotMatch(
    TOOLS,
    /patch\(\s*args\.docId|patch\(\s*id,\s*\{[^}]*content/,
    "the voice surface must never patch a document's content",
  );
});

test("the voice surface has no way to apply, delete or restore", () => {
  for (const forbidden of ["acceptProposal", "remove", "restoreVersion", "setArchived"]) {
    assert.ok(
      !TOOLS.includes(`export const ${forbidden}`),
      `${forbidden} must not be reachable with only the shared secret`,
    );
  }
});

test("a proposal is stored pending, not applied", () => {
  const propose = fnIn(TOOLS, "propose");
  assert.ok(propose, "the propose mutation is missing");
  assert.match(propose, /status: "pending"/, "a voice proposal must start pending");
  assert.match(propose, /origin: "voice"/, "a voice proposal must record where it came from");
});

test("every voice function checks the shared secret", () => {
  // Without it the whole writing workspace is one URL away from anyone.
  for (const name of ["search", "read", "blocks", "create", "propose"]) {
    const body = fnIn(TOOLS, name);
    assert.ok(body, `${name} is missing`);
    assert.match(body, /checkToolSecret\(/, `${name} does not check the secret`);
  }
});

// ------------------------------------------------------- accepting one

test("a proposal stores what the block said when it was made", () => {
  const table = SCHEMA.split("studioProposals: defineTable")[1]?.split("index(")[0] ?? "";
  assert.ok(table, "studioProposals table missing");
  assert.match(table, /original: v\.string\(\)/);
  assert.match(table, /proposed: v\.string\(\)/);
  assert.match(table, /blockIndex: v\.number\(\)/);
});

test("accepting refuses when the block no longer says what it said", () => {
  // A proposal can sit for an hour, and in that hour the paragraph may have
  // been rewritten by hand. Applying anyway deletes the rewrite and the screen
  // looks entirely correct afterwards.
  const accept = fnIn(STUDIO, "acceptProposal");
  assert.ok(accept, "acceptProposal missing");
  assert.match(accept, /!== proposal\.original/, "accept must compare against the stored original");
  const guard = accept.indexOf("!== proposal.original");
  const write = accept.indexOf("replaceBlockText");
  assert.ok(guard >= 0 && write >= 0, "both the comparison and the write must exist");
  assert.ok(guard < write, "the comparison must come before the write");
});

test("accepting moves the revision forward", () => {
  // Otherwise a tab that has been open since before the proposal still holds a
  // passing stamp, and its next autosave quietly wipes the accepted text out.
  const accept = fnIn(STUDIO, "acceptProposal");
  assert.match(accept, /revision \+ 1/, "accepting must bump the revision");
});

test("rejecting never touches the document", () => {
  const reject = fnIn(STUDIO, "rejectProposal");
  assert.ok(reject, "rejectProposal missing");
  assert.doesNotMatch(
    reject,
    /content|replaceBlockText/,
    "rejecting must not write to the document",
  );
});

test("the review panel only ever shows what is still pending", () => {
  const list = fnIn(STUDIO, "proposals");
  assert.ok(list, "the proposals query is missing");
  assert.match(list, /"pending"/, "the panel must filter to pending proposals");
});

// ---------------------------------------------------------- the persona

test("the persona tells her she proposes and never applies", () => {
  const persona = PROVISION.split("export const PERSONA =")[1]?.split("`;")[0] ?? "";
  assert.ok(persona, "the persona is missing");
  assert.match(persona, /propose_studio_edit/, "the persona must describe the editing tool");
  assert.match(
    persona,
    /never apply|cannot apply|do not apply|proposes/i,
    "the persona must say she does not apply her own edits",
  );
});

test("the persona tells her to quote the passage rather than describe it", () => {
  // She has no cursor. A quote is the only handle she has on a paragraph.
  const persona = PROVISION.split("export const PERSONA =")[1]?.split("`;")[0] ?? "";
  assert.match(persona, /quote/i, "the persona must tell her to pass a quote");
});
