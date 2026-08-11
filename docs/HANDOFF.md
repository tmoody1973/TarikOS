# Handoff — Tarik OS, 2026-08-11 (late)

Studio is no longer an island. All three gaps from this morning's handoff are
closed, deployed, and exercised against production.

**Read first**
- Today's commits. They carry the reasoning; do not re-derive it.
- `docs/decisions/2026-08-11-studio-in-the-brain.md` — why Studio kept its own
  store, and why there is deliberately NO search index.
- `docs/decisions/2026-08-11-studio-editor.md` — why Plate.
- The previous handoff's traps still apply. They are not repeated here.

## State

`main` in sync with origin. **744/744 tests, tsc clean, `next build` green.**
Convex deployed, agent provisioned, Vercel deployed. Everything below was called
against production, not read.

Working tree carries only `.claude/`, which is not yours to decide on.

## What is live

**Studio in the picker.** `studioSources.search` reads a seventh table and
`studio` is a reference type, so a document can cite another document. `search`
takes an optional `excludeDocId` so a document never offers itself.

**Studio in the brain.** `recall` returns Studio documents; `hybridRecall`
vector-searches `studioDocs` as a fifth table. Both verified with a query that
shares no word with the document — text recall returned nothing, the vector path
returned it.

**Four tools.** `find_studio_document`, `read_studio_document`,
`write_studio_document`, `propose_studio_edit`. She resolves to exactly one
document or asks; she quotes a passage to address it; she proposes and never
applies. A proposal appears in the open document while she is still talking, and
the index shows a count when it is closed.

## Two decisions worth not re-opening

**No `plain` column and no search index on `studioDocs`.** A Convex search index
needs a plain-text field, and a document is stored as the editor's JSON tree —
indexing that makes every document match a search for "children". A `plain`
column beside `content` is a second copy of the document's words inside its own
row, which is the drift this project rejected twice today. Text recall ranks the
live rows with `rankSources` instead: the SAME function the picker uses, so
Studio has one ranking rule everywhere.

It costs a scan of a table bounded by how fast one person writes. **If Studio
ever holds thousands of documents, `secondBrain.recall` is the line that
changes** — and only that line.

**Embedding on snapshot, never on save.** `save` fires on a 900ms debounce while
someone is typing. `snapshot` — "keep version" — is the one act that means
"worth coming back to", which is the text worth being findable. Between
snapshots a document is still findable by its WORDS; only the semantic half
waits, and the nightly consolidation runs the same backfill anyway.

`embeddedRevision` records which revision the vector came from. The other four
tables clear their embedding when their text changes, so absence means "due" —
but a Studio document is edited for weeks and always has an embedding, of some
earlier revision.

## Traps — new ones, from today

- **Splitting a route case on the first `}` lands inside a template literal.**
  Two of my own guardrails asserted `doesNotMatch` against a string that had
  been cut off before the thing it forbade. They passed while guarding nothing.
  Split on the branch's own closing brace (`"\n      }"`).
- **An ordering assertion can read source position when it means evaluation
  order.** `rankSources(` is written BEFORE `archivedAt` on the page and
  evaluated AFTER it. The right assertion reaches inside the call's arguments.
- **`git push` did not deploy this project** for the whole of today, which left
  production on the old build while Convex was already on the new schema. Fixed
  at the end of the session: the GitHub repo is now connected
  (`vercel git connect`), so **a push to `main` deploys the Next app**.
  **Convex still does not.** See "Open, needs Tarik" — until the deploy key
  exists, a schema change is still two steps, and the drift can now run the
  other way: Vercel ahead of the schema.
- **`npx vercel --prod` no longer deploys; it builds and tells you to promote.**
  Use `npx vercel deploy --prod` for a manual one.
- **Every Clerk-gated Convex function is unreachable from `npx convex run`.**
  Anything you want to verify from a terminal has to be on the secret-gated
  surface, or verified in the browser.
- The previous handoff's traps all still stand — codegen is not deploy,
  no `.npmrc`, read past the shadcn installer's file list, screenshots are
  upscaled, Grammarly blocks synthetic typing, localhost Clerk loops.

## Known gaps, deliberately left

**Studio**
- **There is no Sources picker UI.** `studioSources` is backend-only and always
  has been — `search`, `references`, `addReference` and `removeReference` have
  no caller in `src/`. Gap 1 as written was a backend gap and is closed; the
  panel that would let Tarik attach a source by hand is unbuilt. This also means
  `excludeDocId` has no caller yet, and `studioSystemPrompt`'s grounding is only
  exercised through the voice path.
- **An untitled document is not findable by the word "untitled".** Its stored
  title is empty; `Untitled brief` is a display fallback applied after ranking.
  It is still findable by its words. Low stakes, but it will look like a bug.
- ⌘J still applies directly through Plate's own menu — it does not create a
  `studioProposals` row. The voice path and the screen path therefore share the
  TABLE but not yet the menu. Pointing ⌘J at `studioProposals` is the next
  obvious move and the panel is already built for it.
- A proposal addresses a TOP-LEVEL block. A quote inside one list item resolves
  to the whole list, which is usually what someone means and occasionally is not.
- The AI is grounded in reference **labels**, not their contents.
- No PDF. No Canvas. `.docx` still never opened in Word.

**Contacts** — unchanged: whole-field editing only, iCloud unbuilt.

## Open, needs Tarik

- **A Convex production deploy key**, to finish the deploy story. It can only be
  minted from the Convex dashboard — Settings → Deploy Keys → Generate
  Production Deploy Key (needs `deployment:deploy`). Then, in this repo:

  ```
  npx vercel env add CONVEX_DEPLOY_KEY production      # paste the key
  ```

  Once it exists, set the Vercel build command to
  `npx convex deploy --cmd 'npm run build'` and a push ships the schema and the
  app together, in that order. **Do not set the build command before the key
  exists** — every deploy would fail at the Convex step.
- **Two archived test documents** — "Zebra pledge drive test" and "Zebra
  ambiguity test". Archived, so they are out of the picker, out of recall and
  out of the embedder. There is no delete button in the UI (`studio.remove`
  exists and is wired to nothing), so they stay archived until one is added.
- **Open an exported .docx in Word** and confirm it is not corrupt. Still open.
- **iCloud app-specific password**, if the iCloud half of MOO-499 is wanted.
- **MOO-529** — thirty seconds in airplane mode. Open since four handoffs ago.
- **Try `propose_studio_edit` by actually talking to her.** Every path was
  exercised over HTTPS and in the browser, but not once through the voice agent,
  and the quoting ritual lives in the persona where only a real call tests it.

**Settled, do not raise again:**

- The Telegram bot token rotation. Proposed, declined.
- **`.env.local`.** Verify against production instead.
- **The Studio editor uses shadcn components.** One written, scoped exception.
- **Studio's text recall has no search index.** Decided today, written up, and
  the `plain` column that would enable it is the thing to resist.

## Tarik

They/them. Decisive — picks and moves, dislikes re-litigation. Answers very
short, so put the recommended option first and make it unambiguous.

**When they ask a one-word question, give a one-line answer.** Read the length
of the question.

Write in plain language. Lead with what they can do now.

They push back accurately, and they will click a button in production while you
are still testing it — the first proposal of the day was accepted by them,
mid-verification, which is how the accept path got exercised at all.

## Suggested skills

- **`superpowers:test-driven-development`** — test → RED → implement → GREEN.
  Both new guardrail files were written before the code and both caught real
  mistakes in the first run.
- **`superpowers:verification-before-completion`** — before any "done".
- **`ponytail`** — active all day.

`npx next build` before saying done. Pushing `main` now deploys the app —
but run `npx convex deploy` yourself whenever the schema or a Convex function
changed, until the deploy key lands.
