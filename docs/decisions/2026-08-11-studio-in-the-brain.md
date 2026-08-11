# Putting Studio in the second brain

**Decision record · 2026-08-11 · Tarik OS**
**Status:** Decided — `studioDocs` keeps its own recall path, embedded on
snapshot

---

## Context

Studio shipped as an island. Its documents were invisible to `recall`, to the
semantic search, and to the source picker — so Tarik could write a plan in the
morning and Zola would say "nothing in the second brain matches that" when he
asked about it in the afternoon.

Two questions had to be answered before anything could be built, and the handoff
that raised them insisted both be answered deliberately rather than by whichever
path was quickest to type.

## Question 1 — does a Studio document become a *thought*?

`recall` searches `thoughts` and `memories`. The cheap fix is to copy a
document's text into `thoughts` on save. It requires no schema change and no new
code in the recall path.

**Rejected.** A copy is a second answer to "what does this document say", and it
is wrong from the first keystroke after it is written. Every subsequent edit
widens the gap, silently, in a table nobody looks at.

That is not a new argument here. This project made it twice on the same day:

- Studio **links** to briefs rather than owning them, so there is one brief.
- Studio's DOCX exports land in `documents` rather than a new export table, so
  there is one answer to "what have I shared?"

The rule both times was **one canonical store per kind of thing**. A Studio
document is its own kind of thing. It gets its own path into recall.

## Question 2 — how is a Studio document found?

Two halves, and they were decided differently.

**Words: ranked, not indexed.** `recall` reads the live `studioDocs` rows and
ranks them with `rankSources` — the *same* function the source picker uses.

The obvious alternative was a Convex `searchIndex`, which is what `thoughts` and
`memories` use. It was rejected for a specific reason: a search index needs a
plain-text field to index, and a document is stored as the editor's JSON tree.
Indexing that tree makes every document match a search for "children" or "type".
So the index would require a `plain` column maintained beside `content` — **a
second copy of a document's words inside its own row**, which is question 1's
mistake at smaller scale, with more write paths to forget.

Ranking the live rows costs a scan of a table bounded by how fast one person
writes, and it buys something the index would not: Studio has ONE ranking rule
wherever it is searched from. The picker and the brain cannot disagree about
which document Tarik meant.

*If Studio ever holds thousands of documents, this is the line that changes* —
and the change is local, in `recall`.

**Meaning: a vector index, like everything else.** `studioDocs` gets
`by_embedding` at 1024 dimensions on `voyage-3.5-lite`, identical to `memories`,
`thoughts`, `telosItems` and `journalEntries`, and joins `vectorHits` as a fifth
table. Nothing novel; the machinery already existed.

## Question 3 — when is a document embedded?

**On snapshot. Never on save.**

`save` fires on a 900ms debounce while someone is typing. Embedding there would
call Voyage several times per sentence, on text that is mid-word, for a document
that will change again in four seconds.

Keeping a version is the one act in Studio that means *this is worth coming back
to* — which is exactly the text worth being findable. So `snapshot` schedules the
backfill.

Three things make that safe rather than merely cheap:

- Between snapshots a document is still findable **by its words**, because text
  recall ranks the live rows. Only the semantic half waits.
- The nightly memory consolidation runs the same backfill, so a document nobody
  ever snapshots is embedded within a day regardless.
- Staleness is a **comparison, not a flag**. `embeddedRevision` records which
  revision the vector was made from. The other four tables clear their embedding
  when their text changes, so "no embedding" means "due" — but a Studio document
  is edited for weeks and always *has* an embedding, of some earlier revision.
  A boolean could not tell today's text from last Tuesday's.

The revision is captured with the text and stamped back after the vector
returns, not read again at write time. By then the document may have moved on,
and stamping it with the newer number would mark work as done that was never
done.

## Consequences

- One new table's worth of schema on `studioDocs`: `embedding`,
  `embeddedRevision`, and a vector index.
- `recall` gains a `studio` key. Additive, so the agent and the tool route that
  formats it keep working.
- Archived documents are excluded from both halves — from the text ranking
  before it ranks, and from the vector results after they return, since a vector
  index cannot filter on a field it was not built with.
- The `plain` column that was NOT added is the thing to resist next time. It
  will look obviously useful.
