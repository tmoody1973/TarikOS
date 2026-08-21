# 02 — Who writes the edges

Type: grilling
Status: resolved
Blocked by: —

## Question

This is the load-bearing question of the whole effort. A graph's value is its edges, and
the PRD never resolves where they come from.

Three sources, with different failure modes:

1. **Inference → review → approval.** Honest provenance, but it only works while Tarik
   keeps approving. When he stops, the graph is a pile of unreviewed proposals — which is
   worse than no graph, because now it looks populated and isn't trustworthy.
2. **Explicit statement only.** "This blocks that." Trustworthy and near-zero maintenance,
   but sparse: he has to think in edges, and most people don't.
3. **Structural derivation.** A task already belongs to a project in Plane; a brief already
   cites its sources; a reminder already names a person. These edges exist in the data and
   need no approval because nobody inferred them.

Option 3 looks underrated and is absent from the PRD. If most edges are derived rather than
inferred, the review queue shrinks to almost nothing and the graph is populated on day one.

Decide the mix, and decide what an edge with no human approval is allowed to do — can Zola
speak from it, or only surface it?

## Answer

**Most edges are derived, one kind is stated, and nothing is inferred in v1.**

The ticket offered three sources and the schema supplied a better answer than any of them.
Roughly eight of the PRD's twelve relation types are already sitting in this codebase as
ordinary columns:

- `habits.telosItemId` is a habit *supports* a goal.
- `memories.transcriptId` and `thoughts.transcriptId` are *derived_from* a conversation.
- `documents.sourceType` + `sourceId` is a document *derived_from* a brief, research run or
  journal digest.
- `studioRefs.docId` + source is a document *informed_by* a source.
- Plane already knows which project a task *belongs_to*.
- Calendar attendees are an event *involves* a person.
- `reply_zero` already computes thread *involves* sender.

None of those require a guess or an approval. They are facts about data that already
exists, so the graph is populated on day one at zero maintenance cost. This is the option
the PRD does not consider, and it is the one that carries the effort.

**The single genuine gap is dependency** — `blocks` and `depends_on`. Nothing in the system
records that one thing waits on another, and nothing can derive it. That is the one edge a
human has to state, by voice: "the portfolio blocks the case study."

**Inference is out for v1.** Not because it is wrong, but because it is the only thing on
the list that manufactures review work, and unapproved guesses are exactly what turn a
graph into a junk drawer. The destination is a system that survives without maintenance;
inference is the maintenance. Turning it on later is purely additive, and by then there is
a real graph to judge what is actually missing.

**The rule that makes this safe — provenance governs speech.** Where an edge came from
decides what Zola may do with it:

- Derived, or stated by Tarik: she may speak from it as fact.
- Inferred: she may only raise it as a question, never assert it.

Since nothing is inferred in v1, **the review queue starts empty** — which is the outcome
ticket 05 was worried about, reached by removing the cause rather than capping the symptom.
