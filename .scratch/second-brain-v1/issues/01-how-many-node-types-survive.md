# 01 — How many node types survive

Type: grilling
Status: resolved
Blocked by: —

## Question

The PRD defines thirteen node types and twelve relation types. PARA famously ships four
buckets, on the argument that every extra category is another decision at the moment of
capture, and decisions at capture time reduce capture.

Against that: agent-memory research says structure still earns its place — but for the
agent's judgement, not for human browsing. Which suggests the surviving types are the ones
Zola needs in order to answer differently, not the ones that would make a tidy sidebar.

So: which types survive v1, and what is the test for keeping one? A candidate test — *keep
a type only if Zola would say something different because a record has it.* Under that
test `decision` earns its place (she can cite it and note it was superseded); `area` may
not (it is a browsing aid).

Note that several proposed types already exist as canonical records elsewhere — tasks and
projects in Plane, habits, reminders, telos items, documents, briefs. A surviving type may
mean "project a reference to the existing row", not "a new kind of thing".

## Answer

**Two types are chosen; the rest name themselves.**

The test holds: keep a type only if Zola would say something different because a record has
it. The reason is capture friction — every type is a question she has to ask at the moment
of capture, and capture friction is the documented first cause of death for these systems.

Applying it broke the question open. The thirteen proposed types are two different things
mashed together.

**Inherited types — never chosen.** Ten of the thirteen already have a canonical home:
person in `contacts`, goal in `telosItems`, habit in `habits`, memory in `memories`,
document in `documents`/`studioDocs`, task and project in Plane, event in Google Calendar.
A brain node that points at one of these inherits its kind from what it points at. Nobody
picks anything, and capture stays free.

**Native types — the only ones chosen.** Two survive:

- `decision` — the one real gap in the system. Rationale, date, and supersession are stored
  nowhere today, and this is the type that lets her say "you decided this in March, here is
  why, and it still holds". It passes the test louder than anything else on the list.
- `open_loop` — something unresolved that has no date and no email. `reminders` requires a
  date; `reply_zero` only sees mail. This is the hole between them.

**Ruled out, with reasons:**

- `commitment` merges into `open_loop` as an optional due date and an optional person.
  Reminders, commitments and open loops are three words for "a thing I owe" and two of them
  are redundant.
- `area` drops to a tag. It changes the shape of a menu, not the content of an answer.
- `source` drops as a type. Provenance is already an attribute stamped on every record; it
  is a fact about a thing rather than a thing.

**Storage rule (Q2).** Point, never copy — a copy is a thing that can disagree, and the
copy in question is his contact list. The one concession is speed: a node caches the
*title* of what it points at, so she can name something without a network call, and fetches
the canonical row only when he asks for detail. The latency objection that would normally
sink this was retired the night before, when slow tools started speaking before they run.
