import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOCX_CONTENT_TYPE, studioExportName } from "../src/lib/documentBuilders.ts";

// Exporting a Studio document into the store that already knows how to share
// things.
//
// The point is not the .docx file. It is that the file lands in `documents`,
// which already does presigned URLs, expiry, download caps and revocation —
// so a Studio export inherits a whole distribution system rather than growing
// a second one. Same reasoning that made Studio link to briefs rather than own
// them: one canonical store per kind of thing.

test("the filename carries the date, the title and the revision", () => {
  // The revision is what tells two exports of the same document apart. Without
  // it, a folder of downloads is several files with one name and no way to
  // know which is current.
  const name = studioExportName("Turnout in the 4th", 7, Date.UTC(2026, 7, 11));
  assert.match(name, /^2026-08-11-turnout-in-the-4th-r7\.docx$/);
});

test("an untitled document still produces a usable filename", () => {
  // A Studio document can be untitled for as long as its author likes.
  const name = studioExportName("", 1, Date.UTC(2026, 7, 11));
  assert.match(name, /^2026-08-11-document-r1\.docx$/);
});

test("a title that is all punctuation cannot produce a broken name", () => {
  // Same rule objectKeyFor already enforces: an empty slug would give
  // "2026-08-11--r1.docx".
  const name = studioExportName("!!! ???", 2, Date.UTC(2026, 7, 11));
  assert.ok(!name.includes("--"), `double hyphen in ${name}`);
  assert.match(name, /document/);
});

test("a very long title is cut, so the filename stays a filename", () => {
  const name = studioExportName("x".repeat(300), 1, Date.UTC(2026, 7, 11));
  assert.ok(name.length < 120, `filename too long: ${name.length}`);
  assert.ok(name.endsWith("-r1.docx"), "the revision must survive truncation");
});

test("the extension is always .docx, whatever the title says", () => {
  // A title of "notes.pdf" must not produce "notes.pdf.docx" ambiguity or,
  // worse, a name Word refuses to open.
  const name = studioExportName("notes.pdf", 3, Date.UTC(2026, 7, 11));
  assert.ok(name.endsWith(".docx"));
  assert.equal(name.match(/\.docx/g)?.length, 1);
});

test("the content type is the one Word actually expects", () => {
  // application/msword is the OLD binary .doc type. Sending it with a .docx
  // makes Word complain the file is corrupt.
  assert.equal(
    DOCX_CONTENT_TYPE,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
});

// Wiring.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const ROUTE = CODE("src/app/api/studio/export/route.ts");
const SCHEMA = CODE("convex/schema.ts");
const DOCS = CODE("convex/documents.ts");

test("studio is a first-class source type, not smuggled in as another", () => {
  // Labelling an export a "brief" would put it under the wrong filter on
  // /documents and lie about where it came from.
  const table = SCHEMA.split("documents: defineTable")[1]?.split("index")[0] ?? "";
  assert.match(table, /v\.literal\("studio"\)/);
  assert.match(DOCS, /v\.literal\("studio"\)/, "saveDocument must accept it too");
});

test("an export knows which document it came from", () => {
  // sourceId is the whole reason this is a reference rather than an orphan
  // file: a year later the .docx still points at the Studio document.
  //
  // Asserted at the CALL. A bare /sourceId/ passed with it dropped from
  // saveDocument entirely, because the word still appears where the form is
  // parsed a few lines above.
  const call = ROUTE.slice(ROUTE.indexOf("api.documents.saveDocument"));
  assert.match(call, /sourceId,/, "the studio document id must reach the row");
  assert.match(call, /sourceType: "studio"/);
});

test("the export route is behind a session", () => {
  const PROXY = CODE("src/proxy.ts");
  assert.match(ROUTE, /await auth\(\)/);
  assert.match(ROUTE, /401/);
  assert.ok(!/api\/studio/.test(PROXY), "the export route must not be public");
});

test("an oversized upload is refused before it reaches the bucket", () => {
  // The blob is generated in a browser and posted here. Without a ceiling, an
  // embedded-image document decides how much R2 storage a click costs.
  // Compared against the CALL, not the identifier: `uploadBuffer` also appears
  // in the import at the top of the file, which is earlier than everything and
  // made this ordering assertion meaningless.
  assert.match(ROUTE, /if \(file\.size > MAX_EXPORT_BYTES\)/);
  const guard = ROUTE.slice(ROUTE.indexOf("if (file.size > MAX_EXPORT_BYTES)"));
  assert.match(guard.slice(0, 220), /413/, "an oversized export must return 413");
  assert.ok(
    ROUTE.indexOf("if (file.size > MAX_EXPORT_BYTES)") < ROUTE.indexOf("await uploadBuffer("),
    "the size check must come before the upload",
  );
});

test("the bytes go to the bucket before the row is written", () => {
  // A row pointing at an object that was never stored is a document that
  // appears on /documents and 404s when downloaded.
  assert.ok(
    ROUTE.indexOf("uploadBuffer") < ROUTE.indexOf("saveDocument"),
    "upload must precede the database row",
  );
});

test("the object key is built by the shared helper, never by hand", () => {
  // objectKeyFor carries the traversal and collision rules. A second key
  // format here would quietly skip both.
  assert.match(ROUTE, /objectKeyFor\(/);
  assert.ok(!/`documents\//.test(ROUTE), "must not hand-roll a bucket key");
});

test("the export saves to Documents rather than only downloading", () => {
  // Plate's own export button downloads the file and forgets it. The whole
  // reason this one exists is that the bytes join `documents`, where the
  // share links already live.
  const BTN = CODE("src/app/studio/[documentId]/ExportButton.tsx");
  assert.match(BTN, /\/api\/studio\/export/);
  assert.match(BTN, /exportToDocx\(/);
  assert.ok(
    !/link\.download|URL\.createObjectURL/.test(BTN),
    "must not fall back to a plain browser download",
  );
});

test("the export says where the file went", () => {
  // A file that vanishes silently reads as one that failed.
  const BTN = CODE("src/app/studio/[documentId]/ExportButton.tsx");
  assert.match(BTN, /Saved to Documents/);
  assert.match(BTN, /href="\/documents"/);
  assert.match(BTN, /role="alert"/, "and says so when it fails");
});

test("the export names the revision that is actually on screen", () => {
  // The filename carries the revision. Sending the one the page loaded with
  // would label an export of edited text with the number before the edits.
  const EDITOR = CODE("src/app/studio/[documentId]/StudioEditor.tsx");
  assert.match(EDITOR, /setRevisionShown\(result\.revision\)/);
  assert.match(EDITOR, /revision=\{revisionShown\}/);
});
