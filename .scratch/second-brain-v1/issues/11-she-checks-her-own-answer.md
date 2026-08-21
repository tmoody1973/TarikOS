# 11 — She checks her own answer before speaking it

Type: grilling
Status: resolved
Blocked by: —

## Question

Surfaced while reading OpenViking (2026-08-21), not from the original PRD.

OpenViking's strongest idea is not its filesystem — it is the claim that a query should
leave a trail you can inspect: "when a result looks wrong, you can see exactly which path
produced it." That is observability, and it is separable from their retrieval design.

Tarik reframed it through Jarvis, which produced a better standard than the one on offer.
Jarvis never narrates his process and shows his working only when asked — but he volunteers
the *exception* unprompted, and, crucially, he would never have reported last night's
`reply_zero` answer at face value. He would have noticed eighteen was the wrong shape and
said so before Tarik saw it.

So the question is not "should she log her reasoning" but **should she be suspicious of her
own answers before speaking them, and what does she do when one looks wrong?**

## Answer

**She checks the shape of her answer before speaking, fixes what she knows how to fix,
mentions it, and names the doubt when she cannot fix it.** (Tarik's call: "fix it and
mention it.")

**Why this is cheaper than it sounds.** Last night's bad answer was visibly odd before
anyone understood *why* it was wrong: eighteen results where three to five is normal,
fifteen of them from senders carrying unsubscribe headers, the same sender six times. None
of that requires intelligence — it is arithmetic. Most wrong answers are strangely shaped
first and explicably wrong second, so a cheap shape check catches them before any
understanding exists.

This also clears a bar that neither of the alternatives reach. Rebuilding retrieval as a
filesystem would not have caught it (the lookup was correct). Logging the trail would not
have caught it either — the trail would have shown eighteen perfectly reasonable steps,
because every one of those threads genuinely was unanswered. The question was wrong, not
the search, and only self-suspicion notices that.

**Mechanism: a general shape check, with per-tool rules where it is not enough.** The
generic tells are count against a normal range, sameness across results, repetition of a
single source, and concentration. Written once, and it catches the *next* bug, which will
not look like the last one. Per-tool rules supplement it where a tool has a known normal the
generic check misses.

Explicitly rejected: asking a model "does this look right" before every answer. It adds a
model call to the hot voice path that was optimised only the night before, it costs tokens
against a quota that has already been hit once, and models are unreliable judges of their
own output.

**What she does when the check fires — two cases, because "fix it" presumes a known fix:**

- **Fix known:** apply it and say so. "Nine waiting. Set aside 73 as bulk." Informed without
  being made to adjudicate.
- **Fix unknown:** she cannot fix what she does not understand, so she names the doubt and
  stops. "Eighteen waiting — more than usual." No question, no demand; he ignores it or digs.

The second case matters more than it looks. It is the graceful degradation that keeps the
rule honest instead of forcing a fabricated fix.

**Relationship to ticket 06.** Same discipline, one layer earlier. 06 governs what she says
when the *record* is weak; this governs what she says when the *answer* is weak. Both obey
the rule that a signal only carries meaning while it stays rare.
