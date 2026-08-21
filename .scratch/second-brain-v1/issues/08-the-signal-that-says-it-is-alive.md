# 08 — The signal that says this is alive in six weeks

Type: grilling
Status: resolved
Blocked by: —

## Question

The PRD's section 12 says whether the thing *works*. Nothing in it says whether it is
*used* — and given that the destination is "gets better without you maintaining it", used
is the only measure that matters.

Tarik measures things well when he decides to: Phoenix spans, a 107-utterance eval harness,
a known ~2.8 point noise band. None of that is pointed at this.

Decide the one signal that would tell him at six weeks that this is alive rather than
abandoned, and what he does when it says abandoned. Candidates: captures per week; recalls
per week; the ratio of Zola's answers that cite an approved record; review items resolved
versus accumulated; or simply whether he would notice if it were switched off.

The last one is the cheapest and possibly the most honest.

## Answer

**Measure the recall hit rate, not the capture count. Confirm with a switch-off test.**

**First, the reason this ticket matters more than it looked.** Every other decision on this
map removed a way for the system to ask Tarik for something — no review queue, no filing at
capture, no nagging graph, no staleness inbox. That is the destination working as intended,
and it has a cost: **a system that never asks for anything can be dead for months without
saying so.** A nagging system at least proves it is still running. This measurement is the
only thing that will notice, which makes it structural rather than bureaucratic.

**Do not measure captures.** Saving things feels like using the system and is not. A brain
with five hundred captures and no recalls is dead while its capture graph looks healthy —
this is precisely the collector's fallacy the research names, and instrumenting it would
actively mislead.

**Primary signal: the share of recalls that return something.** Ticket 06 supplies this for
free — every recall either answers from a record or falls below the similarity floor and
says it has nothing. The ratio is the health of the brain:

- Answers holding steady → the brain is keeping pace with his life.
- "Nothing on that" climbing → either he is asking about things that were never captured (a
  capture gap) or the floor is set too high (a tuning problem). Both are actionable, and the
  two are distinguishable by looking at what he asked.

This needs no new instrumentation. Phoenix already traces every tool call, and this codebase
already has the habit of reading those spans rather than guessing.

**Secondary: recalls per week, as a trend.** Zero recalls is dead regardless of how full the
store is.

**Tiebreaker: switch it off for a week at the six-week mark.** If he does not notice, it is
dead. The test costs nothing, cannot be gamed, and is more honest than any ratio.

**What "abandoned" means.** Not deletion — the decision store is small and harmless. It
means stop investing: no v2, no further tickets, leave what exists. Deciding in advance what
a negative result licenses is the part that usually goes unwritten, and its absence is why
projects get maintained long past the point anyone believes in them.
