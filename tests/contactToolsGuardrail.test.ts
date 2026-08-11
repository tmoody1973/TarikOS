import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Which contact tools Zola may reach, and what they may hand back (MOO-499).
//
// Comments are stripped before every scan. A guardrail in this repo passed
// three times while guarding nothing, because it matched the word it was
// looking for inside the comment explaining the guard.

const CODE = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const ROUTE = CODE("src/app/api/tools/[tool]/route.ts");
const AGENT = CODE("scripts/provision-agent.ts");
const TEXT = CODE("src/lib/textTools.ts");
const arm = (name: string) =>
  ROUTE.split(`case "${name}"`)[1]?.split(/\n    case "|\n    default:/)[0] ?? "";

test("find_contact is offered to Zola on voice and text", () => {
  // The whole point: resolving a spoken name is her job, not a cron's.
  assert.match(AGENT, /find_contact/);
  assert.match(TEXT, /find_contact/);
});

test("sync_contacts is never offered to Zola", () => {
  // A scheduled full-book pull needs no model judgement, and an exposed
  // version is a way to make her hammer the provider on request.
  assert.ok(!/sync_contacts/.test(AGENT), "sync_contacts must not be an agent tool");
  assert.ok(!/sync_contacts/.test(TEXT), "sync_contacts must not be a text tool");
});

test("an ambiguous name returns every candidate, not a guess", () => {
  const fn = arm("find_contact");
  assert.ok(fn, "find_contact arm missing");
  // The total has to reach her, or a truncated list reads as the whole answer.
  assert.match(fn, /total/);
  assert.match(fn, /Which one\?/);
});

test("a search miss is not reported as a tool failure", () => {
  // ok:false makes Zola apologise for a broken tool; "I don't have anyone
  // matching X" is the true answer and she should just say it.
  const fn = arm("find_contact");
  const miss = fn.slice(fn.indexOf("matches.length === 0"));
  assert.match(miss.slice(0, 200), /ok:\s*true/);
});

test("an empty provider response never wipes the stored contacts", () => {
  // sweepStale deletes everything not seen this run, so a provider outage
  // returning zero rows would empty the address book.
  const fn = arm("sync_contacts");
  assert.ok(fn, "sync_contacts arm missing");
  assert.match(fn, /merged\.length === 0/);
  assert.ok(
    fn.indexOf("merged.length === 0") < fn.indexOf("upsertBatch"),
    "the empty check must come before anything is written",
  );
});

test("the sweep uses the run's own timestamp, never a fresh now", () => {
  // Sweeping on Date.now() would delete rows a concurrent sync just wrote.
  const fn = arm("sync_contacts");
  const sweep = fn.slice(fn.indexOf("sweepStale"));
  assert.match(sweep.slice(0, 200), /syncedAt:\s*startedAt/);
  assert.ok(!/syncedAt:\s*Date\.now\(\)/.test(fn));
});

test("the sync writes in bounded batches and sweeps in bounded passes", () => {
  // ~4,800 rows exceed a single mutation, and an unbounded sweep loop would
  // spin forever if the mutation kept reporting more.
  const fn = arm("sync_contacts");
  assert.match(fn, /CONTACT_BATCH/);
  assert.match(fn, /MAX_SWEEP_PASSES/);
});

test("contact details never reach a log line", () => {
  // Tripwire from the ticket: no PII in logs. Names, numbers and addresses
  // may be spoken back to Tarik, never written to a log the platform keeps.
  for (const name of ["find_contact", "sync_contacts"]) {
    const fn = arm(name);
    assert.ok(!/console\.(log|warn|error)/.test(fn), `${name} must not log`);
  }
  assert.ok(
    !/console\.(log|warn|error)/.test(CODE("src/lib/googlePeople.ts")),
    "the People fetch must not log rows",
  );
});

test("the proxy fetch cannot hang forever", () => {
  // rss-parser hung for minutes on this project because a library's own
  // timeout option did not abort the request. Ours has to be explicit.
  const people = CODE("src/lib/googlePeople.ts");
  assert.match(people, /AbortSignal\.timeout/);
  assert.match(people, /signal:/);
});

test("paging is bounded so a bad token cannot loop", () => {
  const people = CODE("src/lib/googlePeople.ts");
  assert.match(people, /MAX_PAGES/);
  assert.match(people, /pages < MAX_PAGES/);
});

// add_contact writes into a real address book and nothing undoes it.

test("add_contact is offered to Zola, since only she hears the request", () => {
  assert.match(AGENT, /add_contact/);
  assert.match(TEXT, /add_contact/);
});

test("the tool description demands a spoken confirmation first", () => {
  // Same ritual as create_calendar_event. A read can be re-read; a wrong
  // number saved under a right name looks correct and will be dialled.
  const def = AGENT.split('name: "add_contact"')[1]?.split("apiSchema")[0] ?? "";
  assert.match(def, /BEFORE calling this/);
});

test("a refused payload can never reach Google", () => {
  const fn = arm("add_contact");
  assert.ok(fn, "add_contact arm missing");
  assert.match(fn, /!built\.ok \|\| !built\.person/);
  assert.ok(
    fn.indexOf("built.person") < fn.indexOf("createGoogleContact"),
    "the validity check must come before the write",
  );
});

test("an existing number is reported rather than duplicated", () => {
  // A duplicate is not a failed write, it is a slow corruption of the book
  // find_contact reads.
  const fn = arm("add_contact");
  assert.match(fn, /duplicate: true/);
  assert.ok(
    fn.indexOf("duplicate: true") < fn.indexOf("createGoogleContact"),
    "the duplicate check must come before the write",
  );
});

test("what is stored locally comes from Google's own response", () => {
  // Not from the request. Storing what we asked for rather than what Google
  // saved would let the two drift on the very first write.
  const fn = arm("add_contact");
  assert.match(fn, /googlePeopleToContacts\(\[created\]\)/);
});

test("writing uses the write connection, never the read one", () => {
  const people = CODE("src/lib/googlePeople.ts");
  const create = people.split("export async function createGoogleContact")[1] ?? "";
  assert.match(create, /writeAccountId\(\)/);
  assert.ok(!/connectedAccounts\("gmail"\)/.test(create), "must not write via the Gmail connection");
});

test("a write that returns no contact is an error, not a silent success", () => {
  const people = CODE("src/lib/googlePeople.ts");
  assert.match(people, /returned no contact/);
});

// update_contact and delete_contact change or destroy something that was
// already right. Nothing undoes either.

test("editing and deleting are offered to Zola on voice and text", () => {
  for (const name of ["update_contact", "delete_contact"]) {
    assert.match(AGENT, new RegExp(name), `${name} missing from the voice agent`);
    assert.match(TEXT, new RegExp(name), `${name} missing from the text tools`);
  }
});

test("both descriptions demand a spoken confirmation first", () => {
  for (const name of ["update_contact", "delete_contact"]) {
    const def = AGENT.split(`name: "${name}"`)[1]?.split("apiSchema")[0] ?? "";
    assert.match(def, /BEFORE calling this/, `${name} does not demand a confirmation`);
  }
});

test("the edit description warns that a new number replaces the old ones", () => {
  // The trap of Google's field mask, in the one place the model reads before
  // it acts. Without this it will happily overwrite a work line it never saw.
  const def = AGENT.split('name: "update_contact"')[1]?.split("apiSchema")[0] ?? "";
  assert.match(def, /REPLACES every number/);
});

test("neither tool acts when the name matches more than one person", () => {
  // The whole reason resolveOneContact exists. Deleting the wrong Marcus is
  // not recoverable, and picking silently is how that happens.
  const resolve = ROUTE.split("async function resolveOneContact")[1]?.split(
    "\nasync function runTool",
  )[0] ?? "";
  assert.ok(resolve, "resolveOneContact missing");
  assert.match(resolve, /matches\.length > 1/);
  assert.match(resolve, /ambiguous: true/);
  for (const name of ["update_contact", "delete_contact"]) {
    const fn = arm(name);
    assert.ok(fn, `${name} arm missing`);
    assert.match(fn, /resolveOneContact/, `${name} must resolve before acting`);
    assert.ok(
      fn.indexOf("resolveOneContact") < fn.indexOf("Google"),
      `${name} must resolve before it touches Google`,
    );
  }
});

test("a contact that does not live in Google is refused, not silently missed", () => {
  // An iCloud-only row has no writable id. Reporting success over an address
  // book that never changed is worse than saying no.
  const resolve = ROUTE.split("async function resolveOneContact")[1]?.split(
    "\nasync function runTool",
  )[0] ?? "";
  assert.match(resolve, /source === "google"/);
  assert.match(resolve, /ok:\s*false/);
});

test("an edit reads the contact fresh from Google before writing it", () => {
  // Two reasons, both load-bearing: updateContact rejects a stale etag, and
  // the stored row cannot say what the change is about to displace.
  const fn = arm("update_contact");
  assert.match(fn, /getGoogleContact/);
  assert.ok(
    fn.indexOf("getGoogleContact") < fn.indexOf("updateGoogleContact"),
    "the read must come before the write",
  );
  assert.match(fn, /current\.etag/);
});

test("a refused change can never reach Google", () => {
  const fn = arm("update_contact");
  assert.match(fn, /!built\.ok \|\| !built\.person/);
  assert.ok(
    fn.indexOf("built.person") < fn.indexOf("updateGoogleContact"),
    "the validity check must come before the write",
  );
});

test("the confirmation says what the change displaced", () => {
  // The only moment the replaced value still exists anywhere.
  const fn = arm("update_contact");
  assert.match(fn, /built\.replaced/);
  assert.match(fn, /was \$\{/);
});

test("the field mask is never widened past what was asked for", () => {
  // A field named in updatePersonFields is replaced by this body — so a field
  // named without a value in the body is CLEARED.
  const fn = arm("update_contact");
  assert.match(fn, /built\.updatePersonFields/);
  // Naming a Google field HERE is the tell that the mask was hand-written.
  // Checking for `updatePersonFields: "` alone did not catch it — the mask is
  // a positional argument, and a hardcoded one survived that assertion.
  assert.ok(
    !/phoneNumbers|emailAddresses|organizations/.test(fn),
    "the mask must come from the payload builder, never be spelled out here",
  );
});

test("a delete hits Google before the local row is dropped", () => {
  // The other order leaves the contact gone here and alive there, and
  // tomorrow's sync puts it straight back with no sign anything happened.
  const fn = arm("delete_contact");
  assert.ok(
    fn.indexOf("deleteGoogleContact") < fn.indexOf("removeByKey"),
    "Google must be the one to go first",
  );
});

test("a deleted contact stops being findable immediately", () => {
  // Otherwise find_contact keeps offering someone he just deleted, until the
  // next sync.
  assert.match(arm("delete_contact"), /removeByKey/);
});

test("a resource name is checked before it is put in a URL", () => {
  // It arrives from a provider row and is concatenated into a path.
  const people = CODE("src/lib/googlePeople.ts");
  assert.match(people, /function resourcePath/);
  assert.match(people, /\^people\\\//);
  for (const fn of ["getGoogleContact", "updateGoogleContact", "deleteGoogleContact"]) {
    const body = people.split(`export async function ${fn}`)[1]?.split("\nexport ")[0] ?? "";
    assert.ok(body, `${fn} missing`);
    assert.match(body, /resourcePath\(/, `${fn} must not use a raw resource name`);
  }
});

test("editing and deleting use the write connection, never the read one", () => {
  const people = CODE("src/lib/googlePeople.ts");
  for (const fn of ["getGoogleContact", "updateGoogleContact", "deleteGoogleContact"]) {
    const body = people.split(`export async function ${fn}`)[1]?.split("\nexport ")[0] ?? "";
    assert.match(body, /writeAccountId\(\)/, `${fn} must use the write connection`);
    assert.ok(
      !/connectedAccounts\("gmail"\)/.test(body),
      `${fn} must not go through the Gmail connection`,
    );
  }
});

test("the new arms keep contact details out of the logs", () => {
  for (const name of ["update_contact", "delete_contact"]) {
    assert.ok(!/console\.(log|warn|error)/.test(arm(name)), `${name} must not log`);
  }
});
