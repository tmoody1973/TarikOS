# The second brain that survives

**Decision record · 2026-08-21 · Tarik OS**
**Status:** Decided — eleven questions answered; v1 is two new stores and one new screen

---

## Decision

Build the smallest second brain that gets better without being maintained — two new
kinds of record, connections read from data that already exists, and no queue, no
filing and no tidying anywhere in it.

## Why this came up

A 1,386-line design document arrived proposing a whole-life second brain: thirteen kinds
of thing, twelve kinds of relationship between them, five screens, a review queue with
seven categories, and five phases of building. It was a good document — thorough, careful
about privacy, and unusually thoughtful about where information came from.

What was at stake is not that it would fail to work. It is that it would work, get built,
and then quietly die.

That is the normal outcome for this kind of system, and by 2026 the failure has a name:
**second brain fatigue** — the exhaustion of maintaining a setup that produces more filing
than thinking. Every major method for personal knowledge management assumes the owner keeps
sorting and linking things, week after week, and that assumption is where they break. The
research is blunt about it: the systems that survive are low-maintenance by design, measured
in minutes rather than hours.

So the risk was building a beautiful thing that asks for twenty minutes a day and gets
abandoned in six weeks — after the effort, and with nothing to show.

Rather than build it or bin it, the questions were mapped out and answered one at a time.
Eleven of them, in `.scratch/second-brain-v1/`.

## Options

**Build the document as written.** Everything in it is defensible on its own terms, and it
had already been thought through carefully. *The cost:* five phases of work, and a system
whose central surface is a review queue — a list of things waiting for approval. Queues of
that kind are exactly what people stop opening. There was direct evidence to hand: a tool
shipped the week before produced a list of eighteen items and was useless until it was
filtered down to about ten with the important one at the top.

**Keep what already exists and change nothing.** The current memory works — notes get saved,
nightly processing pulls durable facts out of conversations, and semantic recall (search by
meaning rather than by exact words) finds things. *The cost:* the actual complaint stays
unfixed. Zola does not know things she should — most obviously that a decision was ever made,
because nothing in the system stores what was decided or why.

**Decide first, then build the smallest version that survives.** Answer the open questions
before writing code, and let the answers cut the scope. *The cost:* a morning of deciding
before anything ships, and a real risk of cutting something that turns out to matter.

## What we chose and why

**The third, jointly.** Tarik set the four answers that fixed the scope — that "done" means a
locked small version rather than a buildable specification, that the pain is Zola not knowing
things rather than daily disorientation, that voice is the way in, and that "memory" means one
store and not two. Claude did the research, the fact-finding against the existing codebase,
and the drafting; Tarik made every call that changed direction, including keeping the graph
view and choosing how Zola should behave when she suspects her own answer.

The cutting went further than expected, and mostly because the answers kept revealing that
the system already had the thing being proposed:

**Thirteen kinds of thing became two.** Ten of the thirteen already live somewhere — people
in Contacts, tasks and projects in Plane, events in Google Calendar, notes in the existing
memory table. Those do not need a new home; they need a pointer, like a desktop shortcut.
Only two had nowhere to live: a **decision** (what was chosen, and why) and an **open loop**
(something unfinished with no date and no email attached). The test used throughout: keep a
category only if Zola would *say something different* because a record has it.

**The connections build themselves.** Roughly eight of the twelve proposed relationship types
were already sitting in the database as ordinary columns — a habit already points at the goal
it serves, a note already points at the conversation it came from, Plane already knows which
project a task belongs to. Nobody has to approve a fact. Only one relationship genuinely needs
a human: *this is blocking that*, which is said out loud.

**She guesses nothing.** Guessing is the only thing that manufactures approvals, and
unapproved guesses are what turn a knowledge system into a junk drawer. Removing it means the
review queue starts empty rather than merely capped. Switching it on later is purely additive.

**Old things sink instead of queueing.** Two kinds of old were being treated as one. Something
still true but rarely needed just gets quieter. Something that might no longer be true gets a
single question — asked when it comes up in conversation, never as a list to work through. A
record nobody uses never needs checking, so nothing is ever spent on it.

**Five screens became one.** Four had been dismantled by the other answers without anyone
noticing. "Areas" had become a tag. "Review" had nothing left to review. "Recall" is voice.
And the fifth — a daily orientation screen — already exists: the morning brief does exactly
what it was specified to do, spoken, on a schedule, without anything being opened.

**And the best idea did not come from the document.** Asked how Iron Man's Jarvis would
behave, the answer turned out to be sharper than either option on the table: he never narrates
his process, but he would never have reported eighteen waiting emails at face value either. He
would have noticed the shape was wrong and said so first. So Zola checks her own answer before
speaking — fixes what she knows how to fix and mentions it, names the doubt and stops when she
cannot. This is cheaper than it sounds, because bad answers are *strangely shaped* before they
are explicably wrong, and noticing that is arithmetic rather than intelligence.

## What we gave up

**Serendipity, and this is the real loss.** Because she guesses nothing, she will never
surprise Tarik with a connection he had not seen. That is a genuine part of what people want
from a second brain, and it has been traded away deliberately for a system that does not
accumulate chores. If the graph turns out to be inert and obvious, this is the decision to
revisit first.

**A cold start.** The decision store is empty and fills only as decisions get made. Old
conversations do contain decisions and were checked — nightly processing has been reading every
transcript since it shipped, but only ever looking for facts, so the decisions in them are
genuinely unmined. They stay unmined, on the grounds that recall is almost always about recent
things.

**Speed, in exchange for one source of truth.** Pointing at Plane and Google instead of copying
them means fetching over the network while Tarik waits. This was acceptable only because slow
tools started announcing themselves the night before; without that it would have been a bad
trade.

**A category that might be missed.** Cutting "areas" from a real kind of thing down to a tag
assumes life domains are a way of labelling rather than a way of thinking. If browsing by
Career or Health turns out to matter, that is a rebuild rather than an adjustment.

**A screen that is admittedly decoration.** The whole-graph view — everything at once, in one
picture — is being kept knowingly, because a tool that is a pleasure to open is a tool that
keeps getting opened. It is not expected to help anyone find anything.

*(Jargon, once: **semantic recall** means searching by what something means rather than by the
exact words in it — which is why it can find a note about "the portfolio" when you asked about
"my case study". Its catch is that it never comes back empty: asked a question it cannot answer,
it returns the nearest thing anyway, which is why Zola has to be able to say "nothing on that".)*

## How we'll know if this was right

**The measure is how often recall returns something, not how much gets saved.** Saving things
feels like using the system and is not — a brain with five hundred saved notes and no successful
recalls is dead while its save count looks healthy. Every recall either answers from a record or
reports that it has nothing, and the ratio between those is the health of the thing. Tracing is
already in place, so this costs nothing to watch.

If the "nothing on that" share climbs, one of two things is true and they are distinguishable by
reading the questions asked: either things are not being captured, or the threshold for "I have
nothing" is set too high.

**And the honest test, at six weeks: switch it off for a week.** If it is not missed, it is dead.
That cannot be gamed and it is worth more than any ratio.

**What a negative result licenses:** stop investing. Not deletion — the decision store is small
and harmless. No second version, no further work, leave what exists. Deciding this in advance is
the part that usually goes unwritten, and its absence is why projects get maintained long past
the point anyone believes in them.

## What actually happened

<!-- Tarik fills this in. -->
