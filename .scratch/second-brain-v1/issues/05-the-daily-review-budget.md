# 05 — The daily review budget, and where it lands

Type: grilling
Status: open
Blocked by: —

## Question

Settled already: review rides in the morning brief rather than a separate screen, because
the brief is the recurring ritual that already survives and a Review screen is the thing
that dies.

What is not settled is volume and authority.

**Volume.** There is direct evidence from this codebase: `reply_zero`'s first live run
produced eighteen items and was useless until a filter cut it to ten with the important one
first. A review queue has the same failure curve. What is the daily cap, and what happens
to the overflow — does it wait, merge, or expire unreviewed?

**Authority.** Which approvals can happen by voice? Existing house rules say voice never
deletes permanently and never silently changes priority. But approving an inferred edge is
lower-stakes than that. If nothing can be approved by voice, the brief can only *mention*
the queue, and the queue still needs a screen — which reopens the thing we just closed.


## Narrowed by ticket 02 (2026-08-21)

The volume half of this ticket is largely answered: with no inference in v1, nothing
generates proposals, so **the review queue starts empty**. The cap question is moot until
inference is turned on.

What remains, and what this ticket is now about:

1. **Stale items.** If ticket 04 decides that untouched records surface for confirmation
   rather than sinking quietly, that is a queue — and it is the only one v1 has. Its volume
   is set by the decay policy, not by inference.
2. **Authority.** Which approvals may happen by voice at all. Still live, because it
   governs what the brief can offer rather than merely mention, and because it is the rule
   inference will need the day it arrives.

This ticket is now blocked on 04 alone; 02 is resolved.


## Narrowed again by ticket 04 (2026-08-21)

04 decided stale records are confirmed *when used*, not surfaced on a timer — so there is no
stale queue either. Both volume sources are now gone, and this ticket is only its second
half: **which approvals may happen by voice at all.**

That still matters. It governs what the morning brief can *offer* rather than merely
mention, and it is the rule inference will need on the day it is switched on. Retitle when
resolved; "budget" no longer describes it.
