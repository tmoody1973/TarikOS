# Map: The second brain that survives

Label: `wayfinder:map`

## Destination

A locked v1 scope for the TarikOS whole-life second brain: **the smallest version that
gets better without Tarik maintaining it.** Reaching the end of this map means every
decision below is made and the remaining PRD is buildable — not that anything is built.

Source document: `~/Downloads/tarikos-whole-life-second-brain-graph-prd.md` (1,386 lines,
status Proposed). This map does not replace it; it decides what survives of it.

## Notes

**Domain:** personal knowledge management, agent memory, voice-first capture.

**Skills every session should consult:** `grilling` and `domain-modeling`. Add `research`
only when a decision waits on a fact from outside this repo.

**Settled before charting** (Tarik, 2026-08-21) — these fix the scope and are not tickets:

1. *Done* = a locked v1 scope, not a buildable spec. The PRD is over-specified for one
   user; the destination is the version still in use in six weeks.
2. *The pain* = "Zola didn't know something she should have." Recall with authority.
   NOT daily orientation — the morning brief already answers what to work on.
3. *The front door* = voice. The dashboard is where he inspects what she did, which
   makes it v2.
4. *"Memory" is one store, not two.* The PRD's `memory` node type is a projection of
   the existing `memories` table, never a parallel store.

**The finding that reframes the PRD.** Every major PKM method assumes the human keeps
filing and linking, week after week; that assumption is where they break, and by 2026 the
failure has a name — "second brain fatigue." Meanwhile agent-memory research says
structure and provenance still matter, but for *the agent's judgement*, not for human
browsing, and the state of the art is temporal (how facts change) rather than richer
taxonomy. That splits the PRD: the provenance model is on the right side of the line, the
thirteen node types and seven review categories are on the wrong side.

**The asset the PRD does not use.** PKM's universal failure is the recurring human review
everyone drops. Tarik already has one that runs itself: the morning brief — spoken, on a
cron, with a lede that reads every section. A separate Review screen is the thing that
dies; the brief is the thing that doesn't.

**Standing preferences:** plain language over jargon; features over instrumentation;
decisions get written down in `docs/decisions/` in language a smart non-engineer can
follow; behaviour changes get measured against the eval harness before and after, three
runs, because the noise band is ~2.8 points.

## Decisions so far

<!-- one line per closed ticket -->

- [01 — How many node types survive](issues/01-how-many-node-types-survive.md) — two are
  chosen (`decision`, `open_loop`); the other ten are pointers that inherit their kind from
  the canonical row, so capture asks nothing. `commitment` merges into `open_loop`, `area`
  drops to a tag, `source` drops to an attribute. Nodes point and never copy, but cache the
  title so she can speak without a fetch.
- [02 — Who writes the edges](issues/02-who-writes-the-edges.md) — most are derived from
  columns that already exist (`habits.telosItemId`, `memories.transcriptId`,
  `documents.sourceType`, Plane, Calendar, `reply_zero`), so the graph is populated on day
  one at zero cost. Dependency (`blocks`) is the one edge a human must state. No inference
  in v1, because it is the only source that manufactures review work — so the review queue
  starts empty. Provenance governs speech: derived and stated may be spoken as fact,
  inferred may only be asked.
- [04 — What happens to a record nobody touches](issues/04-what-happens-to-untouched-records.md)
  — two kinds of old, handled oppositely. Cold (still true, rarely needed) sinks silently in
  recall ranking with no status change and no queue. Stale (truth in question) is confirmed
  *when used*, never on a timer — she hedges and asks in the moment. Shelf life comes from
  the existing `memories.type` field: `fact` never expires, `project` rots fastest.
  "Touched" means cited by Zola. Nothing is ever deleted automatically.
- [03 — What capture asks for](issues/03-what-capture-asks-for.md) — nothing, which is
  already how `remember` and `capture_thought` behave; the job is not regressing it. The two
  new verbs do not ask either: an open loop is just the sentence, and a decision's rationale
  is written from what he just said and read back once for a yes. Governing rule: never ask
  for what the conversation already contains. Guessing is safe because embeddings make
  misfiled records findable anyway, and cheap mistakes are what buy zero friction. Undo
  rather than approval.
- [05 — The voice authority rule](issues/05-the-daily-review-budget.md) *(was "the daily
  review budget")* — voice may do anything reversible that she can say back in one sentence.
  The binding constraint is bandwidth, not risk: voice cannot do comparison, so anything
  needing several things held side by side is a screen job even when it is perfectly safe.
  Existing stops unchanged — no permanent deletion, no *silent* priority or identity change.
  Superseding passes. v1 has nothing to approve; if inference ever arrives, the brief raises
  one item and never reads a list.
- [06 — What Zola says when the answer is weak](issues/06-what-zola-says-when-the-answer-is-weak.md)
  — claim strength matches record strength. Stale: state it, date it, ask once. Conflict:
  name both, say which is newer, never pick silently. **Nothing: say so first.** Embeddings
  never return empty, so recall needs a similarity floor or she will cite the nearest row as
  an answer — noise with a citation, which is worse than silence. Near-misses come after the
  "no", labelled as near-misses. And when she does know, no hedge at all: hedges only carry
  information while they stay rare.
- [07 — Is the Map in v1](issues/07-is-the-map-in-v1.md) — **yes**, Tarik's call, and ticket
  02 reversed the lean this was written with: edges are derived, so the graph is populated
  on day one instead of sparse for months. Two features, not one — a *local* graph (one or
  two hops, the actual tool) and a *whole* graph (a view, honestly budgeted as decoration).
  Hard guard: it must never nag. No orphan counts, no connectedness score, no unlinked-
  mentions prompt — that is filing in a costume, and filing is what kills these systems.
  Voice is still the front door.

## Not yet specified

- What the dashboard becomes once voice is the front door. Now / Recall / Review / Map /
  Areas are five surfaces in the PRD; if voice is the front door, most are inspection.
  Can't sharpen until the graph's v1 status is decided.
- How this meets Plane — mostly cleared by tickets 01 and 02: the brain points at Plane
  rows rather than copying them, and Plane's own task-to-project link is a derived edge.
  What remains dim is the read path — whether recall queries Plane live on every question
  or works from a periodically refreshed local view, which is a latency and staleness
  tradeoff nothing has forced yet.
- Whether Studio documents participate as nodes, and what that buys.
- Migration of the existing `memories`, `thoughts` and `briefs` rows — shape depends on
  which node types survive.
- Sensitive-domain policy (health, finances). The PRD asserts scope and access policy but
  nothing downstream depends on it yet.

- The similarity floor for "I have nothing" is a real number that must be chosen against
  real queries. Ticket 06 settled that a floor must exist and what she says below it; the
  value itself is tuning, and belongs to implementation rather than this map.

## Out of scope

<!-- ruled beyond the destination -->
