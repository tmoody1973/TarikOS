# Handoff: second brain v1

**Written** 2026-08-21 morning, at the end of the session that charted and closed the
decision map. **Every path, table name and line number below was checked by reading the
files, not recalled.**

**Read this and the map, and you can build without re-deriving anything.**

---

## The one thing that will go wrong

There is a 1,386-line PRD at
`~/Downloads/tarikos-whole-life-second-brain-graph-prd.md` proposing thirteen node types,
twelve relation types, five screens, a seven-category review queue and five phases.

**It is not the spec. Do not build it.**

Eleven decisions cut it down deliberately, over a morning, with Tarik making every call that
changed direction. A fresh context window that reads the PRD and starts building will
rebuild exactly the thing that was removed, and it will look reasonable the whole way,
because the PRD is a good document. It is just a good document for a system that would be
abandoned in six weeks.

**Read the map first. The PRD is background.**

## Where everything is

| Thing | Path | State |
|---|---|---|
| The map | `.scratch/second-brain-v1/map.md` | closed; Decisions-so-far is the index |
| The eleven tickets | `.scratch/second-brain-v1/issues/` | all 11 `Status: resolved` |
| The decision record | `docs/decisions/2026-08-21-second-brain-that-survives.md` | merged, retro blank for Tarik |
| The original PRD | `~/Downloads/tarikos-whole-life-second-brain-graph-prd.md` | untouched, background only |

Each ticket has a `## Answer` section holding the full reasoning. The map only gists them.
When something below seems arbitrary, the ticket says why.

## What v1 is

**Two new stores. One new screen. No maintenance surface anywhere.**

- **`decision`** — what was chosen and why. Rationale, date, and what it superseded. This is
  the one genuine gap in the system; nothing stores it today.
- **`open_loop`** — something unresolved with no date and no email. The hole between
  `reminders` (needs a date) and `reply_zero` (only sees mail). A person and a due date are
  optional fields, never prompted for.

Everything else is a **pointer** to a row that already exists, inheriting its kind from what
it points at. Nobody chooses a type at capture time.

**Connections come from columns that already exist** — verified:

| Existing column | The relationship it already is |
|---|---|
| `habits.telosItemId` (`convex/schema.ts:240`) | a habit *supports* a goal |
| `memories.transcriptId` (`:24`) | a memory *derived from* a conversation |
| `thoughts.transcriptId` (`:39`) | same, for thoughts |
| `documents.sourceType` + `sourceId` (`:300`) | a document *derived from* a brief or research |
| Plane (external) | a task *belongs to* a project |
| Google Calendar (external) | an event *involves* a person |
| `reply_zero` (already computes it) | a thread *involves* its sender |

**Only one relationship needs a human: `blocks`.** Said out loud. Nothing derives it.

**She guesses nothing.** No inference in v1. This is the load-bearing decision — it is why
the review queue starts empty rather than merely capped, and switching inference on later is
purely additive.

## The rules that are easy to violate by accident

Each of these was a decision, not an oversight. Breaking one quietly reintroduces the
maintenance tax the whole design exists to avoid.

- **Capture asks nothing.** `remember` takes only a type, which Zola picks silently;
  `capture_thought` takes tags and items. Neither has ever interrogated Tarik and neither
  may start. A decision's rationale is written from what he just said and read back once for
  a yes — that is a confirmation, not a question.
- **Never ask for what the conversation already contains.**
- **Point, never copy.** A node caches the *title* of what it points at so she can name
  something without a network call, and fetches the canonical row only for detail.
- **Nothing is surfaced on a timer.** Cold records (still true, rarely needed) sink silently
  in recall ranking. Stale records (truth in question) are confirmed *when used* — she hedges
  and asks in the moment. Shelf life comes from `memories.type`, which is already
  `preference | fact | project | person`; `fact` never expires, `project` rots fastest.
- **Recall needs a similarity floor, and she must say "nothing on that" first.** Embeddings
  never return empty — asked a question they cannot answer they return the nearest row, and
  noise with a citation is worse than silence. Any near-miss comes *after* the no, labelled.
- **She checks her own answer before speaking it.** A cheap shape check — count against a
  normal range, sameness, repetition, source concentration. Where she knows the fix she
  applies it and mentions it ("nine waiting, set aside 73 as bulk"); where she does not, she
  names the doubt and stops ("eighteen waiting — more than usual"). Explicitly **not** a
  model call in the voice path.
- **Voice may do anything reversible it can say back in one sentence.** The binding limit is
  bandwidth, not risk: voice cannot do comparison, so anything needing several things held
  side by side is a screen job even when perfectly safe.
- **The graph must never nag.** No orphan counts, no connectedness percentage, no
  unlinked-mentions prompt. Tidying a graph is filing in a costume.

## What to build

**One new screen: the graph**, inside the existing `brain` route. Two modes — a *local*
graph (one or two hops, the working tool) and a *whole* graph (a view, honestly budgeted as
decoration; Tarik wants it and the reasoning is in ticket 07). Its **node inspector is the
detail view** — there is no separate detail screen.

`navigate_ui` already exists (`scripts/provision-agent.ts`) and already pushes pages to his
browser mid-conversation. It needs **one new target** so she can focus the graph on a node,
which is what lets her answer and place the thing on screen in the same breath.

**No other screen.** "Areas" became a tag. "Review" has nothing to review. "Recall" is voice.
And the daily orientation screen already exists — it is the **morning brief**, which does
exactly what Now was specified to do, spoken, on a cron.

**Nothing is backfilled.** Both stores start cold. Tarik asks about recent decisions, so they
fill at the rate he needs them. (Noted while checking: nightly consolidation has read every
transcript since it shipped but its schema only extracts `new_memories`, `updates`, `deletes`
and `telos_updates` — decisions are genuinely unmined if that premise ever changes. The three
hand-written files in `docs/decisions/` are copying rather than inference, so importing them
is optional and conflicts with nothing.)

## Traps, learned this week

- **A test that cannot fail is worse than no test.** The house method: mutate the source the
  test claims to protect, watch it fail, restore it, watch it pass. Two decorative tests were
  caught this way in the `reply_zero` work — one asserted the constant it read, one left a
  regex boundary unpinned.
- **Timeouts are ceilings, not speeds.** `propose_studio_edit` is configured at 60s and
  actually runs in about 7. Measure latency from Phoenix spans (`tool.<name>`), never from
  the configured timeout.
- **`--prod` on every Convex CLI call.** Dev is a different deployment and an empty table
  there produces a confident wrong diagnosis.
- **Read the agent back off the live API after provisioning.** `provision-agent.ts` prints
  "Updated agent" whether or not anything landed.
- **The eval harness now caches its prefix**, so runs are cheap. Baseline is roughly 70–72%
  with a noise band of about 2.8 points across three runs; a two-point move is nothing. Take
  the baseline *before* any prompt or description change, three runs, not one.
- **Don't put quotes in a `git commit -m`.** Use a heredoc; a quoted message broke a commit
  in this session and the files looked committed when they were not.

## Definition of done for v1

- [ ] `decision` and `open_loop` tables added to `convex/schema.ts`, additively
- [ ] Both reachable by voice; capture asks nothing; a decision's rationale is read back once
- [ ] Derived edges read from the columns listed above — no approval path, no inference
- [ ] `blocks` statable by voice; ambiguity asks which, per the existing never-pick-between-
      two-matches rule
- [ ] Recall has a similarity floor and says it has nothing *first*
- [ ] Shape check runs before she speaks; fixes-and-mentions, or names the doubt
- [ ] Graph page in the `brain` route, local + whole, with a node inspector, and it never nags
- [ ] One new `navigate_ui` target so she can focus the graph on a node
- [ ] `npm test` green, `npx tsc --noEmit` clean, `npx next build` green
- [ ] Evals three runs before and after; a move inside ~2.8 points is noise
- [ ] Recall hit rate visible in Phoenix — the aliveness signal from ticket 08

## Scope this does NOT include

Inference of any kind. A review queue. An "areas" screen. A Now screen. Backfilling old
transcripts. Adopting OpenViking — considered on 2026-08-21 and parked; the licence is not
the blocker (a separate server called over HTTP is closer to using a database), the reason is
that its wins are benchmarked on large messy stores and Tarik's is small and atomic. Revisit
when the "nothing on that" share climbs *and* the cause is retrieval rather than capture gaps.

## Where the current state is

`docs/HANDOFF.md` is the running one. Zola herself changed the night before this map was
charted: she is on `eleven_v3_conversational` with a designed South African voice
(`0OpYRB9XFILqAP5R0BAl`, matching her Nguni name), 49 tools carry call sounds, 19 speak
before running, and her persona gained anticipation lines and an expressive tag range. None
of that affects this build, but it changes how she sounds while you test it.
