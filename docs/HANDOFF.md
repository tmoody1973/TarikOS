# Handoff — Tarik OS, 2026-08-11 (evening)

Studio shipped today, from nothing to a full writing workspace in production.
It works, and it is an **island**: everything works inside it and nothing
outside knows it exists.

Your job is to end that. Three things, in this order:

1. **Make Studio documents findable** — by the source picker, and by `recall`.
2. **Put them in the brain** — searchable, and embedded like everything else.
3. **Give Zola Studio tools** — find, read, write, edit.

**Read first**
- The commit messages from today. They carry the reasoning; do not re-derive it.
- `docs/decisions/2026-08-11-studio-editor.md` — why Plate, and three reversals.
- The previous handoff's traps still apply. They are not repeated here.

## State

`main` in sync with origin. **690/690 tests, tsc clean, `next build` green.**
Everything below is deployed to production and exercised there.

Working tree carries only `.claude/`, which is not yours to decide on.

## What is live

**Contacts.** `update_contact` and `delete_contact` joined `find_contact` and
`add_contact`. Both resolve to exactly ONE person or refuse — two matches is a
question, never a guess. An edit reports what it displaced, because Google's
field mask replaces a whole field and that is the last moment the old value
exists.

**Studio.** `/studio`, ochre channel. Five document types, autosave, versions,
restore, references, Plate's full editor — floating toolbar, slash menu, drag
handles, tables, lists, media — Zola on ⌘J, and DOCX export into `/documents`.

**Muted mail.** `/control` has a MUTED MAIL panel. Senders and subjects are
excluded **inside the Gmail query**, so a muted message never spends one of the
six slots the inbox asks for, never reaches the brief, and is never read out.

## The three gaps, with what to build

Verified by grep at 16:31 today. All three are genuinely absent, not partial.

### 1. Studio documents are invisible to the picker

`convex/studioSources.ts` `search` reads six tables — `briefs`, `thoughts`,
`telosItems`, `contacts`, `documents`, `transcripts`. **`studioDocs` is not one
of them.** So a Studio document cannot cite another Studio document, which is
the most obvious thing a writing workspace should do.

Smallest correct fix: add a seventh block to that query, and `"studio"` to
`REFERENCE_TYPES` in `convex/studioLib.ts`. Use `plainText(parse(d.content))`
for the snippet — `studioLib` already exports it, and it walks nested blocks so
list items are searchable.

Watch: `rankSources` requires every query term to land somewhere. A document
whose body is long will match on body and score 20, below a title match. That
is correct; do not "fix" it.

### 2. Nothing is in the brain

`recall` (`convex/secondBrain.ts:112`) searches exactly two tables via full-text
indexes: `thoughts.search_cleaned` and `memories.search_content`. There is also
a semantic path — `convex/memoryOps.ts:357` vector-searches `memories`,
`thoughts`, `telosItems`, `journalEntries` on `by_embedding`, 1024 dims,
`voyage-3.5-lite` (`convex/embeddingsLib.ts`).

**Decide deliberately, and record it:** does a Studio document become a
*thought*, or does `studioDocs` get its own search + vector index and join both
recall paths?

The second is almost certainly right, by the rule this project already follows
twice today: one canonical store per kind of thing. Copying a document's text
into `thoughts` creates a second copy that drifts the moment the document is
edited — the same argument that made Studio LINK to briefs rather than own them,
and that put exports in `documents` rather than a new table.

So: add `.searchIndex` and `.vectorIndex` to `studioDocs`, extend `recall` and
the semantic search to include it, and embed on save. **Embedding on every
keystroke-debounced save is too often** — embed on version snapshot, or debounce
hard, or only when the text changed by more than a trivial amount. Decide and
write down why.

### 3. Zola has no Studio tools at all

```
grep -c "studio" scripts/provision-agent.ts src/lib/textTools.ts  →  0, 0
```

Four tools, following the pattern in `AGENTS.md` (route case → `TOOLS` in
`scripts/provision-agent.ts` → `node scripts/provision-agent.ts` → auto-registers
in the `tools` table on first call):

| Tool | Notes |
|---|---|
| `find_studio_document` | Model it on `find_contact`. Ambiguous → return every candidate and ask. |
| `read_studio_document` | Returns `plainText`, not the JSON tree. The tree is noise she can only mangle. |
| `write_studio_document` | Creates a new one from dictation. `templateFor(type)` then append. |
| `propose_studio_edit` | The interesting one — see below. |

**The voice editing design, already agreed with Tarik.** Voice has no cursor, so
she cannot be told "this paragraph". She **quotes** it instead, the same way
`find_contact` resolves a name:

```
You:   "Zola, tighten the paragraph about turnout in the plan."
Zola → propose_studio_edit(document: "plan", quote: "turnout", instruction: "tighten")
Server: finds the plan → finds ONE paragraph containing "turnout"
        → asks Claude, grounded in the document's references
        → writes a PENDING proposal. The document is untouched.
Zola:  "I've suggested a tighter version. It's waiting in the document."
```

Two paragraphs match → she reads both back and asks which. **She never picks.**

**She proposes; she never applies.** Voice cannot show a diff, so voice must not
write. This is not a limitation to engineer around — it is the rule that makes
it safe to let her near his writing. It is also the PRD's own rule.

Because Convex is realtime, a proposal made by voice appears **in the open
document while she is still talking**. If the document is closed it waits, and
the index shows a count.

Build a `studioProposals` table so the screen path and the voice path produce
**the same object** and share one review panel. Today's ⌘J menu is Plate's own
and applies directly; that is fine for now, but the voice path must not grow a
second review UI.

## Traps — each of these cost real time today

- **`npx convex codegen` generates types; it does not deploy.** `studioSources`
  typechecked clean and then failed at runtime with "Could not find public
  function". The tell that distinguishes it: a **validator** error means the
  function exists and your arguments are wrong; "could not find public function"
  means you never pushed. `npx convex dev --once` for dev, `npx convex deploy`
  for prod.
- **`legacy-peer-deps` does not only relax peer CONFLICTS — it disables
  automatic peer INSTALLATION.** An `.npmrc` with it silently removed all seven
  of `@vercel/otel`'s OpenTelemetry peers and broke the build, in dev and on
  Vercel. There is no `.npmrc` now. Do not add one.
- **The shadcn installer prints instructions after the file list.** It said
  "wrap your app with TooltipProvider"; that was skipped and the editor crashed
  in production, because a Radix Tooltip outside its provider **throws** rather
  than degrading.
- **A shadcn registry component assumes shadcn's tokens exist.** Plate's
  components reference seventeen this system never had. Undefined, they render
  as nothing — a toolbar that is present and invisible. They are now mapped onto
  LCARS in `globals.css`; a test enumerates them from `toolbar.tsx`.
- **Screenshots are upscaled from the viewport.** A screenshot came back 1375px
  wide for a 1300px viewport, so clicking at screenshot coordinates landed 40px
  off and typing went into the wrong block. Measure with
  `getBoundingClientRect()` and scale, or click by element ref.
- **Grammarly is installed in Tarik's Chrome.** It attaches to contenteditable
  and blocks synthetic typing entirely, and it injects attributes into `<body>`
  that caused a hydration error until `suppressHydrationWarning` was added. When
  editor automation "does nothing", suspect this before the code.
- **Tarik's localhost Clerk session loops on sign-in.** He ships straight to
  production; do not spend time on it. Verify in prod.

## What the mutation sweep caught today

Twelve weak tests across seven files, and **reading found none of them**. The
recurring shapes, all worth internalising:

- **A regex whose wildcard matches the character under test.** The escaping
  guard was `/-subject:"say .hi. now"/` — `.` matches a double quote, so the
  unescaped output passed its own check.
- **An ordering assertion with no existence check.** `indexOf` returns `-1` when
  code is missing, and `-1 < anything` is true — so the guard passed most
  confidently with the thing it guarded deleted.
- **An ordering assertion against an import.** `uploadBuffer` appears in the
  import line before everything, so comparing against the identifier rather than
  the call was trivially true.
- **A fixture whose incidental ordering does the work.** Ids that happened to
  sort correctly meant the alphabetical tie-break produced the expected answer
  with the real rule deleted. Name fixtures so only the rule under test can pass.
- **A word that appears twice.** `/sourceId/` matched where the form is parsed,
  so dropping it from the database call passed. `/pagehide/` matched the cleanup
  `removeEventListener`, so never adding the listener passed.
- **A cut length that lands on a boundary by luck.** The excerpt test used 30,
  which happens to end a word, so removing word-boundary logic passed.

**Always ask what ELSE would make this assertion pass.**

## Known gaps, deliberately left

**Studio**
- No PDF. Plate's client-side PDF is `html2canvas` + `pdf-lib` — it screenshots
  the editor, so there is no selectable text. Their own docs say it is "not for
  paginated print layout". The good free path is a print stylesheet or headless
  Chrome (Browserbase is already a dependency), and it works with any editor.
- **No .docx has been opened in Word.** Everything around the export is tested;
  the bytes come from Plate's exporter and were never verified.
- Canvas integration is unbuilt because Canvas does not exist. `REFERENCE_TYPES`
  deliberately omits it rather than offering a type nothing can resolve.
- The AI is grounded in reference **labels**, not their contents. Zola is told
  "this is grounded in the brief 'Turnout in the 4th'"; she cannot read it.
- ⌘J applies directly through Plate's menu. There is no stored proposal yet —
  see gap 3.

**Contacts**
- Editing replaces a whole field. Per-value editing ("change his WORK number")
  is unbuilt; the mitigation is that the confirmation names what it displaced.
- iCloud sync still unbuilt; needs an app-specific password.

## Open, needs Tarik

- **iCloud app-specific password**, if the iCloud half of MOO-499 is wanted.
- **MOO-529** — thirty seconds in airplane mode. Open since three handoffs ago.
- **The Telnyx number** (+1 414 635 2386) serves `call_tarik` only and costs
  money. Raised today; he said keep it.
- **Open an exported .docx in Word** and confirm it is not corrupt.

**Settled, do not raise again:**

- The Telegram bot token rotation. Proposed, declined.
- **`.env.local`.** Missing ten variables the Next code reads; all ten are in
  Vercel production, verified by name. Tarik ships straight to production and
  does not run `next dev`. Verify features against production instead: create a
  throwaway record, exercise the tool, delete it.
- **The Studio editor uses shadcn components.** DESIGN.md's "no component
  library" rule carries one written, scoped exception, and a test guards its
  boundary. Do not "correct" it back.

## Tarik

They/them. Decisive — picks and moves, dislikes re-litigation. Answers very
short, so put the recommended option first and make it unambiguous.

**When they ask a one-word question, give a one-line answer.** Late today they
said "hello" and got a status report, then said "what". Read the length of the
question.

Write in plain language. Lead with what they can do now.

They push back accurately. Every push today was right: the reference-vs-link
probe that was bureaucracy, the missing toolbar, "where is the editor", the
Plate AI kit I had walked past, and BlockNote's export licence.

## Suggested skills

- **`superpowers:test-driven-development`** — test → RED → implement → GREEN →
  mutation sweep. Everything that landed cleanly today went through it.
- **`superpowers:verification-before-completion`** — before any "done".
- **`ponytail`** — active all day.

Add `npx next build` to what you run before saying done. `tsc` and the tests
both passed while the build was broken, twice.
