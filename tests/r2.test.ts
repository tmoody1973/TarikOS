import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_PRESIGN_SECONDS,
  contentDisposition,
  requireR2Env,
  checkPresignWindow,
} from "../src/lib/r2.ts";

// r2.ts is I/O — upload bytes, sign a URL — so most of it can only be proven
// against a real bucket. What can be proven here is everything around the
// call: that a missing credential fails by name instead of as a 403 from
// Cloudflare, that a filename can't smuggle anything into a response header,
// and that an expiry window the signer would reject is caught first.

const VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_ENDPOINT",
] as const;

const saved = new Map(VARS.map((v) => [v, process.env[v]]));

function setAll() {
  for (const v of VARS) process.env[v] = `test-${v}`;
}

afterEach(() => {
  for (const [k, value] of saved) {
    if (value === undefined) delete process.env[k];
    else process.env[k] = value;
  }
});

test("all five present — the config comes back", () => {
  setAll();
  const env = requireR2Env();
  assert.equal(env.bucket, "test-R2_BUCKET");
  assert.equal(env.endpoint, "test-R2_ENDPOINT");
  assert.equal(env.accessKeyId, "test-R2_ACCESS_KEY_ID");
});

test("a missing credential fails by name", () => {
  setAll();
  delete process.env.R2_SECRET_ACCESS_KEY;
  assert.throws(requireR2Env, /R2_SECRET_ACCESS_KEY/);
});

test("every missing credential is named, not just the first", () => {
  // Otherwise setting up R2 is five deploys, one per error.
  setAll();
  delete process.env.R2_BUCKET;
  delete process.env.R2_ENDPOINT;
  assert.throws(requireR2Env, /R2_BUCKET/);
  assert.throws(requireR2Env, /R2_ENDPOINT/);
});

test("an empty string counts as missing", () => {
  // Vercel will happily hold an env var set to "".
  setAll();
  process.env.R2_ACCOUNT_ID = "   ";
  assert.throws(requireR2Env, /R2_ACCOUNT_ID/);
});

test("a plain filename is quoted", () => {
  assert.equal(
    contentDisposition("brief.pdf"),
    'attachment; filename="brief.pdf"',
  );
});

test("quotes and newlines cannot escape the header", () => {
  // This value is attacker-adjacent: it comes from a document title.
  const header = contentDisposition('ev"il\r\nX-Injected: yes.pdf');
  assert.ok(!header.includes("\r"), "no CR may survive");
  assert.ok(!header.includes("\n"), "no LF may survive");
  assert.equal(
    (header.match(/"/g) ?? []).length,
    2,
    "exactly the two quotes that delimit the filename",
  );
  // The encoded form has to be checked *decoded*: %0D%0A is invisible in the
  // header and lands as a real newline in the saved filename. The first
  // version of this test only scanned the raw header and a mutation that
  // dropped the CR/LF strip walked straight through it.
  const encoded = /filename\*=UTF-8''(\S+)/.exec(header)?.[1];
  if (encoded) {
    const decoded = decodeURIComponent(encoded);
    assert.ok(!/[\r\n"]/.test(decoded), "nor in the RFC 5987 form, decoded");
  }
});

test("a non-ASCII filename also carries an RFC 5987 form", () => {
  const header = contentDisposition("réunion.pdf");
  assert.match(header, /filename\*=UTF-8''/, "browsers need the encoded form");
  assert.match(
    header,
    /filename="[\x20-\x7e]*"/,
    "and an ASCII fallback for the ones that don't",
  );
});

test("an empty filename still yields a usable one", () => {
  // Exact, not a substring match: a partial assertion let through a version
  // that produced `filename="download"; filename*=UTF-8''` — an empty
  // encoded form, which browsers prefer over the fallback beside it.
  assert.equal(contentDisposition("   "), 'attachment; filename="download"');
});

test("a presign window the signer would reject is caught first", () => {
  assert.throws(() => checkPresignWindow(0), /expir/i);
  assert.throws(() => checkPresignWindow(-60), /expir/i);
  assert.throws(() => checkPresignWindow(MAX_PRESIGN_SECONDS + 1), /expir/i);
  assert.equal(checkPresignWindow(60), 60);
  assert.equal(checkPresignWindow(MAX_PRESIGN_SECONDS), MAX_PRESIGN_SECONDS);
});

test("the signing window tops out at seven days", () => {
  // SigV4's own ceiling. Anything longer is not a policy choice we can make.
  assert.equal(MAX_PRESIGN_SECONDS, 604800);
});

test("r2.ts stays pure I/O — no Convex, no share rules", () => {
  // The ticket's constraint, kept structural: slug generation and the
  // expiry/revocation checks live in convex/documentsLib.ts, and a copy of
  // them here would be a second set of rules to keep in sync.
  const src = readFileSync(new URL("../src/lib/r2.ts", import.meta.url), "utf8");
  assert.ok(!/from "convex/.test(src), "no Convex client in the I/O layer");
  assert.ok(!/documentsLib/.test(src), "no share rules in the I/O layer");
  assert.ok(!/\bslug\b/.test(src), "slugs are documentsLib's business");
});
