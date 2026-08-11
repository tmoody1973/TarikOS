import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Putting Studio in the brain: the rules that must survive a refactor.
//
// Comments are stripped before every scan — a guardrail in this repo passed
// three times while guarding nothing, because it matched the word it was
// looking for inside the comment explaining the guard.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const SCHEMA = CODE("convex/schema.ts");
const BRAIN = CODE("convex/secondBrain.ts");
const OPS = CODE("convex/memoryOps.ts");
const STUDIO = CODE("convex/studio.ts");
const ROUTE = CODE("src/app/api/tools/[tool]/route.ts");

/** One exported Convex function's body, from a given file. */
const fnIn = (code: string, name: string) =>
  code.split(`export const ${name} =`)[1]?.split("\nexport const ")[0] ?? "";

/** One `case "x": { … }` block from the tool route. */
const routeCase = (name: string) =>
  ROUTE.split(`case "${name}":`)[1]?.split("\n    case ")[0] ?? "";

// ------------------------------------------------------------- the schema

test("a studio document can hold an embedding", () => {
  const table = SCHEMA.split("studioDocs: defineTable")[1]?.split("studioProposals")[0] ?? "";
  assert.ok(table, "studioDocs table missing");
  assert.match(table, /embedding: v\.optional\(v\.array\(v\.float64\(\)\)\)/);
});

test("a studio document records WHICH revision was embedded", () => {
  // Not a boolean. A document is edited for weeks, and a flag cannot tell an
  // embedding of today's text from an embedding of last Tuesday's.
  const table = SCHEMA.split("studioDocs: defineTable")[1]?.split("studioProposals")[0] ?? "";
  assert.match(table, /embeddedRevision: v\.optional\(v\.number\(\)\)/);
});

test("studio documents have a vector index at the dimension everything else uses", () => {
  // 1024 is voyage-3.5-lite. A different number here does not fail loudly — it
  // fails as a vector search that silently returns nothing.
  const table = SCHEMA.split("studioDocs: defineTable")[1]?.split("studioProposals")[0] ?? "";
  assert.match(table, /vectorIndex\("by_embedding"/);
  assert.match(table.split('vectorIndex("by_embedding"')[1] ?? "", /dimensions: 1024/);
});

// -------------------------------------------------------------- text recall

test("recall reads studio documents", () => {
  const recall = fnIn(BRAIN, "recall");
  assert.ok(recall, "recall query missing");
  assert.match(recall, /query\("studioDocs"\)/, "recall must read the studioDocs table");
});

test("recall ranks studio documents with the picker's own rule", () => {
  // One ranking rule for Studio wherever it is searched from. Two would let the
  // picker and the brain disagree about which document someone meant.
  //
  // Scoped to the function body, not the file: `studioHit` also appears in the
  // import line, so a file-wide match would pass with the call deleted.
  const recall = fnIn(BRAIN, "recall");
  assert.match(recall, /rankSources\(/, "recall must rank with rankSources");
  assert.match(recall, /studioHit/, "recall must build hits with studioHit");
});

test("recall leaves archived studio documents out", () => {
  // The filter has to be applied to what is RANKED, not to what is returned —
  // filtering afterwards still lets an archived document take one of the five
  // slots and come back as a shorter answer.
  //
  // So the assertion reaches inside the rankSources call rather than comparing
  // source positions: `rankSources(` is written before `archivedAt` on the page
  // and after it in evaluation order, and an indexOf comparison would read that
  // backwards.
  const recall = fnIn(BRAIN, "recall");
  const ranked = recall.split("rankSources(")[1]?.split("searchQuery")[0] ?? "";
  assert.ok(ranked, "recall does not rank anything");
  assert.match(ranked, /archivedAt/, "archived documents must be dropped before ranking");
});

test("recall returns studio hits to its caller", () => {
  const recall = fnIn(BRAIN, "recall");
  const returned = recall.slice(recall.lastIndexOf("return"));
  assert.match(returned, /studio:/, "the recall result must carry a studio key");
});

test("what Zola says about recall counts the studio hits", () => {
  // Otherwise she reports "nothing matches that" while holding a document that
  // does — the worst possible failure for a memory tool.
  const body = routeCase("recall");
  assert.ok(body, "the recall tool route case is missing");
  const count = body.split("count =")[1]?.split(";")[0] ?? "";
  assert.match(count, /studio/, "the spoken count must include studio results");
});

// ------------------------------------------------------------ semantic recall

test("the semantic path vector-searches studio documents", () => {
  const vec = OPS.split("async function vectorHits")[1]?.split("\nfunction ")[0] ?? "";
  assert.ok(vec, "vectorHits missing");
  assert.match(vec, /vectorSearch\("studioDocs", "by_embedding"/);
});

test("semantic studio hits reach the voice path", () => {
  const hybrid = fnIn(OPS, "hybridRecall");
  assert.ok(hybrid, "hybridRecall missing");
  assert.match(hybrid, /studioDocs\b/, "hybridRecall must use the studio vector hits");
});

// ---------------------------------------------------------------- embedding

test("a studio document is due for embedding when its embedding is behind its revision", () => {
  // Comparing the two counters, not testing for absence: a document embedded
  // last week and edited since has an embedding, and it is the wrong one.
  const unembedded = fnIn(OPS, "unembedded");
  assert.ok(unembedded, "unembedded missing");
  assert.match(
    unembedded,
    /embeddedRevision !== .*revision|embeddedRevision \?\?.*!==/s,
    "unembedded must compare embeddedRevision against revision",
  );
});

test("the text sent to the embedder is the writing, not the JSON tree", () => {
  // Embedding the stored string would embed the words "children" and "type"
  // once per block, and every document would sit near every other document.
  const unembedded = fnIn(OPS, "unembedded");
  assert.match(unembedded, /plainText\(/, "studio text must go through plainText");
});

test("storing an embedding records the revision it was made from", () => {
  // Patching the vector without the counter leaves the row due forever: the
  // backfill would re-embed the same document on every pass, every night.
  const store = fnIn(OPS, "storeEmbeddings");
  const studio = store.split("studio.map")[1]?.split("),")[0] ?? "";
  assert.ok(studio, "storeEmbeddings does not patch studio rows");
  assert.match(studio, /embedding/);
  assert.match(studio, /embeddedRevision/);
});

test("keeping a version is what schedules the embedding", () => {
  // The deliberate moment. Everything else is a keystroke.
  const snapshot = fnIn(STUDIO, "snapshot");
  assert.ok(snapshot, "snapshot mutation missing");
  assert.match(snapshot, /backfillEmbeddings/, "snapshot must schedule the backfill");
});

test("an autosave never reaches the embedder", () => {
  // THE cost rule. save fires on a 900ms debounce while someone is typing;
  // embedding there would call Voyage several times per sentence.
  const save = fnIn(STUDIO, "save");
  assert.ok(save, "save mutation missing");
  assert.doesNotMatch(save, /backfillEmbeddings|voyage/i, "save must not trigger embedding");
});
