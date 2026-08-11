import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The rules Studio's persistence layer must not lose (Phase 1).
//
// Comments are stripped before every scan — a guardrail in this repo passed
// three times while guarding nothing, because it matched the word it was
// looking for inside the comment explaining the guard.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const STUDIO = CODE("convex/studio.ts");
const SCHEMA = CODE("convex/schema.ts");

/** One exported Convex function's body. */
const fn = (name: string) =>
  STUDIO.split(`export const ${name} =`)[1]?.split("\nexport const ")[0] ?? "";

test("a document carries a revision counter", () => {
  // Without it there is nothing to compare a save against, and a slow request
  // silently overwrites a newer one.
  const table = SCHEMA.split("studioDocs: defineTable")[1]?.split("index")[0] ?? "";
  assert.ok(table, "studioDocs table missing");
  assert.match(table, /revision: v\.number\(\)/);
});

test("saving requires the revision it was written from", () => {
  const save = fn("save");
  assert.ok(save, "save mutation missing");
  assert.match(save, /revision: v\.number\(\)/, "save must take a revision argument");
});

test("a stale save is refused, not applied", () => {
  // THE rule. A save that left before someone else's landed is carrying an
  // older document; applying it deletes whatever was written in between, and
  // the screen still shows the lost text so nobody finds out.
  const save = fn("save");
  assert.match(save, /revision !== /, "save must compare the incoming revision");
  const compare = save.slice(save.indexOf("revision !== "));
  assert.match(
    compare.slice(0, 260),
    /stale/i,
    "a rejected save must say it was stale, not fail silently",
  );
  assert.ok(
    save.indexOf("revision !== ") < save.indexOf("patch"),
    "the staleness check must come before the write",
  );
});

test("an accepted save moves the counter forward", () => {
  // Matched on `.revision + 1` rather than on the property assignment: the code
  // names it before using it twice, and a guardrail that insists on one
  // spelling fails on a refactor that changed nothing.
  const save = fn("save");
  assert.match(save, /\.revision \+ 1/, "an accepted save must bump the revision");
  assert.match(save, /revision:\s*next/, "and must write the bumped value");
});

test("the counter only ever climbs, including on a restore", () => {
  // Restoring yesterday's CONTENT must not restore yesterday's NUMBER. The
  // number is not part of the document — it records how many times the document
  // has moved. A restore that left it alone would leave a stale tab holding a
  // passing stamp, and its next autosave would wipe the restore out.
  const restore = fn("restoreVersion");
  assert.ok(restore, "restoreVersion mutation missing");
  assert.match(restore, /doc\.revision \+ 1/, "restore must bump the revision");
  // The patch — the write back to the live document — must carry the bumped
  // number. Sliced to the patch call, because `version.revision` legitimately
  // appears above it when the outgoing content is snapshotted.
  const patch = restore.slice(restore.indexOf("ctx.db.patch"));
  assert.match(patch, /revision:\s*next/, "the restore must write the bumped revision");
  assert.ok(
    !/revision:\s*version\.revision\b/.test(patch),
    "restore must not put the old revision back",
  );
});

test("restoring keeps the version it replaced", () => {
  // Otherwise restore is a one-way door: the thing you had a moment ago is
  // gone, and undoing a mistaken restore is impossible.
  const restore = fn("restoreVersion");
  // Existence asserted BEFORE order. `indexOf` returns -1 when the code is
  // absent, and -1 is less than every real index — so an ordering assertion on
  // its own passes most loudly when the thing it guards has been deleted.
  assert.match(restore, /ctx\.db\.insert\("studioVersions"/, "restore must snapshot first");
  assert.ok(
    restore.indexOf('ctx.db.insert("studioVersions"') < restore.indexOf("ctx.db.patch"),
    "the current content must be snapshotted before it is replaced",
  );
});

test("every Studio function is behind a session", () => {
  // These are Clerk-gated, not secret-gated: the callers are browser pages,
  // unlike the tool routes. A missing check exposes private writing.
  const exported = [...STUDIO.matchAll(/export const (\w+) =/g)].map((m) => m[1]);
  assert.ok(exported.length >= 6, `only found ${exported.length} Studio functions`);
  for (const name of exported) {
    assert.match(fn(name), /requireUser\(ctx\)/, `${name} is not behind requireUser`);
  }
});

test("a document's body is never read straight into the page as HTML", () => {
  // Content is a stored JSON tree that will later carry model output. Nothing
  // in the persistence layer may hand it to a raw HTML sink.
  assert.ok(!/dangerouslySetInnerHTML/.test(STUDIO));
});

test("the index does not ship every document's full body", () => {
  // The list screen needs a title and a preview. Sending 200 whole documents
  // to render a list is the mistake that makes the first screen the slowest.
  const list = fn("list");
  assert.ok(list, "list query missing");
  assert.match(list, /excerpt\(/, "the index must send an excerpt");
  assert.ok(
    !/content:\s*d\.content\b/.test(list),
    "the index must not send full document content",
  );
});
