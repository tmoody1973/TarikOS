# 05 — The daily review budget, and where it lands

Type: grilling
Status: open
Blocked by: 02, 04

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
