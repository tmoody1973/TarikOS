# Tarik OS — Telos Layer (LifeOS-inspired life context)

**Date:** 2026-08-07
**Status:** Approved in brainstorming
**Linear:** three issues, created after spec approval (build order at bottom)

## What this is

A Convex-native port of the ideas in danielmiessler/LifeOS's TELOS system:
Zola carries Tarik's life context — mission, goals with measurable criteria,
problems, challenges, current→ideal state per life dimension — in her head
every session, briefs become goal-aware, voice journaling feeds nightly
consolidation, and a weekly voice review keeps the whole thing fresh.
Tarik's existing populated PAI TELOS (`~/.claude/PAI/USER/TELOS/*.md`,
real data, no template samples) is the seed.

What LifeOS does with markdown files and session-start file reads, Tarik OS
does with tables, embeddings, workflows, and voice — including the one thing
the file version can't: the interview and the reviews happen by talking.

## Decisions made

| Decision | Choice |
|---|---|
| Data model | **Structured rows** (`telosItems`), not a single document (LifeOS-faithful blob rejected: everything downstream would re-parse it) and not memory-table overloading (goals need status/measurable/reviewedAt fields memories lack) |
| Initial population | **Seed + voice review** — import script over the PAI TELOS markdown, then Zola walks every imported item by voice to confirm/refresh |
| Journaling | **Both modes** — anytime capture (`journal_entry` tool) and a guided evening reflection workflow (what moved, what stuck, tomorrow's one thing) |
| Review cadence | Weekly voice review, Sunday 9am CT cron; per-kind staleness timers (goals 30d, problems/challenges 90d, mission/dimensions 365d) |
| Consolidation contract | Same as memories (MOO-484): update/merge with transcript provenance, never silent delete; FORGET stays manual |
| UI | One new destination page `/telos`; nothing new on Home. Pattern language holds: orb=presence · zones=summaries · panels=transient reads · pages=destinations |
| Embeddings | telosItems and journalEntries go through the existing Voyage pipeline so semantic recall spans goals and journal |

## Schema

```
telosItems
  kind:        "mission" | "goal" | "problem" | "challenge" | "strategy" | "dimension"
  text:        string            // the item itself (mission text, goal text…)
  measurable?: string            // goals: the ISC ("100 DAU by Q2")
  dimension?:  string            // dimension rows: "health" | "money" | "creative" | …
  currentState?: string          // dimension rows hold both ends —
  idealState?:   string          //   drift is the visible gap
  status:      "active" | "deferred" | "done" | "dropped"
  reviewedAt:  number
  reviewCadenceDays: number      // defaults by kind (30 / 90 / 365)
  source:      "import" | "interview" | "review" | "consolidation"
  transcriptId?: Id<"transcripts">   // provenance when voice-sourced
  (embedding via existing Voyage pipeline)

journalEntries
  text:           string
  mode:           "capture" | "reflection"
  transcriptId?:  Id<"transcripts">
  consolidatedAt?: number        // stamped by the nightly telos pass
  (embedding via existing Voyage pipeline)
```

Indexes: `telosItems` by kind+status; both tables in the vector index.
All store-bound strings pass through `safeSlice()` (lone-surrogate gotcha).

## Seed

`scripts/import-telos.ts` — parses `~/.claude/PAI/USER/TELOS/{MISSION,GOALS,
PROBLEMS,CHALLENGES,STRATEGIES}.md` (bullet-per-item markdown) into
`telosItems` rows with `source: "import"`. Idempotent: matched items update
in place, re-runs never duplicate. Dimension rows start empty and get filled
by the first review. After import, Tarik says "review my telos" and Zola
walks each item — that first session doubles as review #1.

## Zola's head (standing context)

A compiled telos summary — mission, active goals with measurables, top
problems, stale-section flags — is recomputed whenever telosItems mutate and
injected into the agent's standing context at session start. `get_telos`
serves depth on demand.

> **Planning note:** verify the standing-context mechanism during
> implementation planning. If the ElevenLabs agent prompt turns out to be
> provision-time static only, fallback = prompt instruction to call
> `get_telos` at session open. Either way the compiled-summary mutation is
> the same; only the delivery differs.

## Voice tools (3 new, standard webhook pattern)

| Tool | Args | Does |
|---|---|---|
| `journal_entry` | `{ text, mode? }` | Insert journal entry (default mode "capture"); Zola confirms in a few words |
| `get_telos` | `{ kind? }` | Spoken summary of active items, optionally one kind |
| `update_telos_item` | `{ match, text?, status?, measurable? }` | Powers interview + review edits; `match` is fuzzy text match against active items |

Reviews and reflection run through the existing `run_workflow`. All three
auto-register in the tools table, sit behind `toolGate`, use
`x-morpheus-secret`.

## Workflows

- **`weekly-review`** (cron Sun 9am CT = 14:00 UTC): compiles stale items +
  the week's journal entries + notable memories into a review brief (existing
  brief engine); Zola leads the voice session from it; `update_telos_item`
  stamps `reviewedAt` as items are confirmed or changed.
- **`evening-reflection`** (on-demand via voice; schedulable later): Zola asks
  three prompts — what moved, what stuck, tomorrow's one thing — and files
  answers as `journalEntries` with `mode: "reflection"`.
- **`memory-consolidation` gains a telos pass**: nightly run also mines
  unconsolidated journal entries + the day's transcripts for telos-relevant
  signal (goal progress, new challenges, status changes), writes item updates
  with `source: "consolidation"` and transcript provenance, stamps
  `consolidatedAt` on processed entries.
- **`morning-brief` gains a GOALS section**: active goals with measurables, a
  drift line ("this week served G2; nothing touched G0"), and a review nudge
  when sections are past cadence.

## UI — `/telos`

Destination page, NavRail entry. Items grouped by kind; staleness dots
(health-dot idiom: fresh/aging/stale by cadence); status chips; click →
provenance panel (same SlideOver pattern as /brain — source transcript,
history); REVIEW NOW button triggers `run_workflow weekly-review`; a journal
rail listing recent entries. No Home zone in v1.

## Error handling

- Import: unparseable lines collected and printed, never silently dropped;
  script aborts on zero parsed items rather than seeding an empty telos.
- Consolidation telos pass failures don't fail the memory pass (independent
  try/catch, error surfaced in /control last-error).
- `update_telos_item` with an ambiguous `match` → spoken disambiguation, no
  write.
- Journal capture is fire-safe: tool inserts before any enrichment; a Voyage
  outage delays embeddings, never loses the entry.

## Testing

- Unit (workflowLib style, `node --test`): import parser (per-file shapes,
  idempotency key), summary compiler (stale flags, active-only), drift-line
  builder.
- Prod verify (per house practice): import against real TELOS files, one
  voice journal capture, one `get_telos` read-back, GOALS section in next
  morning brief, consolidation telos pass on a real transcript.

## Build order (3 Linear issues)

1. **Telos core** — schema, import script, compiled summary + standing
   context injection, `get_telos`, `update_telos_item`, first voice review
   usable.
2. **Journaling** — `journal_entry` tool, evening-reflection workflow,
   consolidation telos pass.
3. **Goal-aware surfaces** — morning-brief GOALS section, weekly-review
   workflow + cron, `/telos` page.
