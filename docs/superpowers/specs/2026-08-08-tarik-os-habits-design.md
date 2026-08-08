# Tarik OS — Habits Design

**Date:** 2026-08-08
**Status:** Approved in brainstorming; pending written-spec review
**Linear:** MOO-505
**Research source:** `docs/new-feat-research/HABITS_Enhanced.md` and
`Habits_UX_Design_Spec.md` (read in full; this spec is the decision record,
those remain the philosophy)

## What this is

A habits module for Tarik OS built on **identity rather than streaks**. Three
to five life pillars per cycle, each with an identity statement and a daily
"vote." Completion is graded, not pass/fail. A miss is treated as information
about the system — the cue was unclear, the action too large, the context
wrong — and the response is redesign, never guilt.

The module answers one question every evening: *which votes happened today,
and what should change tomorrow?*

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| Relationship to telos | Separate tables; a habit **may** link to a telos item | Telos is what you aim at; habits are what you do daily. The optional link is what lets the weekly review show votes (leading) against goal movement (lagging). |
| Check-in surface | Voice **and** full page, both in v1 | Voice is the low-friction path; the page is where system redesign happens. |
| Evening nudge | Cron composes it and it waits, like the morning brief. SMS later. | No push channel exists yet (MOO-497). This keeps Habits unblocked. |
| Auto-detection | Calendar only, and only as a suggestion | Uses Composio data already on hand; no new integration. |
| Streaks | Not built | The metric is return-after-a-gap. A counter that does not exist cannot be turned on in a weak moment. |

## Data model

Five new Convex tables. `telosItems` is not modified.

### `habitCycles`

A soft 6–8 week container. Not enforced — the weekly review may roll a new
cycle, and pillars can outlive one.

| Field | Type | Notes |
|---|---|---|
| `startsAt` / `endsAt` | number | epoch ms |
| `status` | `"active" \| "closed"` | one active cycle at a time |
| `note` | optional string | what this cycle is for |

### `habits`

| Field | Type | Notes |
|---|---|---|
| `pillar` | string | e.g. "Work / Craft" |
| `identity` | string | "I am a focused professional who…" |
| `telosItemId` | optional `Id<"telosItems">` | the optional link |
| `minimumAction` | string | ≤ 2 minutes, doable on the worst day |
| `standardAction` | string | the normal practice |
| `growthAction` | optional string | only after standard is stable |
| `cue` | string | implementation intention: at TIME, in PLACE, I will X |
| `habitStack` | optional string | after/before an existing reliable habit |
| `backupPlan` | optional string | if DISRUPTION, then SMALLER ACTION |
| `obvious` / `attractive` / `easy` / `satisfying` | optional string | the four design notes |
| `evidenceMode` | `"self_report" \| "calendar_suggest"` | **defaults to `self_report`** |
| `status` | `"active" \| "paused" \| "retired"` | pausing is not failing |
| `cycleId` | `Id<"habitCycles">` | |
| `order` | number | display order |

### `habitVotes`

| Field | Type | Notes |
|---|---|---|
| `habitId` | `Id<"habits">` | |
| `date` | string | Chicago `YYYY-MM-DD`, matching the briefs convention |
| `level` | `"minimum" \| "standard" \| "beyond" \| "skipped" \| "missed"` | `skipped` means a conscious choice and carries no penalty |
| `note` | optional string | |
| `source` | `"voice" \| "ui" \| "suggestion_accepted"` | provenance is always recorded |

One vote per habit per date, enforced by a `by_habit_date` index and a
lookup-then-patch in the mutation rather than by convention. A re-log updates
in place, so history is never double-counted and the trajectory cannot be
inflated by logging twice.

### `habitSuggestions`

The **only** thing the calendar path may write.

| Field | Type | Notes |
|---|---|---|
| `habitId` | `Id<"habits">` | |
| `date` | string | Chicago date |
| `reason` | string | the evidence, in words: "your 9:00 focus block ran" |
| `source` | `"calendar"` | |
| `status` | `"pending" \| "accepted" \| "dismissed"` | |

### `habitFriction`

| Field | Type | Notes |
|---|---|---|
| `habitId` | `Id<"habits">` | |
| `date` | string | |
| `text` | string | what made it hard |
| `variableChanged` | optional string | filled at review: cue / size / location / backup / paused |

## The load-bearing guarantee

**Calendar evidence can only ever produce a `habitSuggestion`. No code path
writes a `habitVote` from inferred data.**

This is the same structural shape as draft-never-send in the mail module: the
machine proposes, a human commits. It is enforced the same way — a source-scan
tripwire test — rather than trusted to prompt wording.

A habit whose `evidenceMode` is `self_report` rejects suggestions **at the
mutation**, not in the UI. Relationship, health and reflection pillars are
therefore structurally uninferable, which is stronger than politely
uninferred. `self_report` is the default, so a new habit is private unless
deliberately opened up.

## Surfaces

A new `HABITS` rail entry. It needs an LCARS channel colour of its own —
amber, lavender, blue, cyan, salmon and steel are taken — so this adds
`--lcars-sage: #99cc99` to `globals.css` and DESIGN.md. That value follows the
palette's existing `99`/`cc` construction (`#99ccff` blue, `#cc99cc`
lavender), so it sits at the same lightness and takes black cap type like its
siblings.

Three panels, per the UX spec:

**Left — identity and system console.** Active pillars, the identity statement
for the selected one, its cue, minimum vs standard, and the friction log. This
is where redesign happens after a miss.

**Centre — today's votes.** One row per active habit with a terminal-style
level picker, because "minimum" and "standard" are different truths and a
checkbox cannot tell them apart. Pending calendar suggestions appear here as
questions to accept or dismiss, never as pre-ticked rows.

**Right — trajectory and field notes.** A blocky heatmap coloured by *level*,
a place to record lagging indicators, and a short rotating principle from the
research doc, chosen against recent friction.

**There is no streak counter.**

## Voice and rhythm

Five webhook tools in the existing pattern, so each self-registers in
`/control` with a health dot and a kill switch:

| Tool | Purpose |
|---|---|
| `get_habits` | today's votes, pending suggestions, and what is still open |
| `log_habit_vote` | habit + level + optional note |
| `add_habit` | the Protocol Builder conversation: identity → standard → minimum → cue |
| `update_habit` | change one variable; pause; retire |
| `log_friction` | what made it hard today |

Two cron changes:

1. **Evening check-in composer** — builds the prompt at the configured window
   and lets it wait on the dashboard, exactly as the morning brief does. It
   cannot nag, by construction. The calendar suggestion pass runs here.
2. **Sunday weekly review** — the existing telos review gains a habits
   section: trajectory, the most reliable cue, the highest-friction moment,
   and the "change one variable" prompt.

## Error handling and edge cases

| Case | Behaviour |
|---|---|
| No active cycle | The page invites creating one; tools say so rather than erroring |
| Habit logged twice in a day | Updates in place; the later level wins |
| Calendar unavailable | Suggestions are simply absent; check-in proceeds on self-report |
| Suggestion for a `self_report` habit | Rejected at the mutation and logged as a bug, not silently dropped |
| Vote for a paused or retired habit | Rejected with a spoken explanation |
| Distress signals in a friction note or check-in | The agent instruction routes to human support and does **not** propose more tracking; carried in the provisioned instruction and covered by a test the way the browse guardrails are |

## Testing

Pure helpers under `node --test`, matching house practice:

- Cycle date maths and "which cycle is active"
- Trajectory aggregation, including return-after-gap (the metric on display)
- Suggestion eligibility — the function that decides whether a habit may
  receive one at all

Tripwires:

- The calendar path cannot write to `habitVotes` (source scan)
- `self_report` is the default in the schema and in the add path
- No streak counter exists in the codebase
- The agent instruction carries the distress-escalation rule

## Out of scope for v1

GitHub commit and PR detection · growth-version escalation · points, scores or
leaderboards · any inference about relationship quality or health status ·
importing from a third-party habit tracker · SMS nudges (arrives with MOO-497).

## Open items

1. The check-in window is configurable and its default is set during the first
   Protocol Builder conversation rather than hard-coded here. Until that
   conversation happens the composer uses 18:00 Chicago.

## Note on sequencing

This is one coherent module, but it is a large one — five tables, three
panels, five tools and two cron changes. The implementation plan should
sequence it internally: schema and pure helpers first, then the voice tools
(which make it usable on their own), then the page, then the cron and calendar
suggestions. Each of those is independently verifiable, and the module is
useful to its owner after the second step.
