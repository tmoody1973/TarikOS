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

## Not yet specified

- What the dashboard becomes once voice is the front door. Now / Recall / Review / Map /
  Areas are five surfaces in the PRD; if voice is the front door, most are inspection.
  Can't sharpen until the graph's v1 status is decided.
- How this meets Plane. Tasks and projects already live there with their own hierarchy;
  whether brain edges duplicate, reference, or ignore that structure is unclear until the
  edge question resolves.
- Whether Studio documents participate as nodes, and what that buys.
- Migration of the existing `memories`, `thoughts` and `briefs` rows — shape depends on
  which node types survive.
- Sensitive-domain policy (health, finances). The PRD asserts scope and access policy but
  nothing downstream depends on it yet.

## Out of scope

<!-- ruled beyond the destination -->
