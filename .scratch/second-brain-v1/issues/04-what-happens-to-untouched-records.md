# 04 — What happens to a record nobody touches

Type: grilling
Status: resolved
Blocked by: —

## Question

The PRD has `stale`, `archived`, `superseded`, and an `expiresAt` — but staleness is
surfaced *for review*, which means decay costs attention instead of saving it. Nothing in
the system forgets on its own.

Every long-lived personal system needs a way for unimportant things to sink without a human
deciding they should. The question is what "sink" means here:

- **Quiet demotion:** stale records rank lower in recall and are never volunteered, but
  remain findable when asked directly. No review item, no notification.
- **Hard expiry:** `expiresAt` passes and the record is archived automatically, with an
  undo window.
- **Nothing:** everything persists at equal weight; the graph grows forever.

Also decide whether "touched" means read, cited by Zola, edited, or only explicitly
confirmed — the definition determines what survives.

## Answer

**Cold records sink silently. Stale records are confirmed when used, never on a timer.
Nothing is ever deleted automatically.**

The PRD's error here is treating all "old" as one thing. There are two, and they want
opposite handling:

- **Cold** — still true, rarely needed. "Tarik is architect-trained." Being old says nothing
  about whether it holds.
- **Stale** — the truth is genuinely in question. "Tarik is focused on the portfolio" was
  true in August and may not be in November.

A single `stale` status cannot serve both. Cold should get quieter; stale should get asked
about.

**Shelf life comes from the type, and the field already exists.** `memories.type` is
already one of `preference | fact | project | person`:

- `fact` — never expires.
- `person` — long half-life; people change slowly.
- `preference` — long half-life.
- `project` — short. This is the type that actually rots, and it is the one whose staleness
  causes wrong answers.

**Cold → silent demotion.** Rank lower in recall, never volunteered, still returned when
asked directly. No status change the user sees, no notification, no queue, nothing to do.

**Stale → confirm on use, never on a schedule.** When Zola is about to *speak* a record past
its half-life, she hedges and asks in the moment: "You were focused on the portfolio — is
that still where you are?" One question, asked when it is relevant, and the answer is
immediately useful to the conversation already happening.

The reasoning: **a record nobody uses never needs confirming.** If she never reaches for it,
its staleness costs nothing, so spending the user's attention on it is pure waste. Tying
confirmation to use means maintenance only ever touches live records, and it happens inside
a conversation rather than in a queue the user must remember to visit.

**"Touched" means cited by Zola in an answer** — not read, not edited. Citation is
automatic and needs no human action, which is the point.

**No automatic deletion, ever.** Archive on explicit request only. The standing house rule
holds: never delete what he cannot get back.

**Consequence for ticket 05:** there is no stale queue, so 05 loses its second volume
source. What remains of it is only the voice-authority question.
