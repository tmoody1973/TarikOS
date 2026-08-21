# 07 — Is the Map in v1 at all

Type: grilling
Status: open
Blocked by: 02

## Question

The PRD devotes a full section to a focused graph view: scoping, node semantics, an
inspector, twelve controls, accessibility requirements. It is the most expensive surface in
the document.

Two facts pull against it. Voice is the front door, which makes the graph an inspection
tool rather than a daily one. And a graph is only worth rendering if it has edges worth
looking at — which is ticket 02, unresolved.

The honest options: **v1** (build it small and scoped), **v2** (decide it now, build later),
or **out of scope** (the node inspector inside existing pages gives most of the value, and
the canvas gives the rest to nobody).

Ruling it out of scope is a legitimate outcome. If it goes, say so on the map's Out of
scope section with the reason, rather than leaving it to rot as a phase nobody starts.
