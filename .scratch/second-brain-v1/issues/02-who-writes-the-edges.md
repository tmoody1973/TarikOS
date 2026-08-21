# 02 — Who writes the edges

Type: grilling
Status: open
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
