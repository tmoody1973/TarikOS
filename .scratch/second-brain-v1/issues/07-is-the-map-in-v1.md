# 07 — Is the Map in v1 at all

Type: grilling
Status: resolved
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

## Answer

**The graph stays in v1, as two distinct things, and it is forbidden from ever asking for
anything.** (Tarik's call, 2026-08-21: "I would like to keep the graph like Obsidian.")

**Ticket 02 is what makes this affordable, and it reverses the lean this ticket was written
with.** The original worry was that a graph is only worth rendering if it has edges worth
looking at, and edges were unresolved. They resolved in the best possible direction: most
edges are derived from columns that already exist, so the graph is populated on day one at
zero cost. That is the opposite of the usual Obsidian experience, where the vault is sparse
for months because every link is typed by hand. Here there is something to look at
immediately, and nothing had to be maintained to get it.

**Two features, not one.** "An Obsidian-style graph" conflates:

- **Local graph** — the neighbourhood around one thing, one or two hops. This is the working
  tool: why is this blocked, what touches this person, what informed this decision. It is
  also what the PRD's section 7 actually describes (scoped, 20–40 nodes, explainable).
- **Whole graph** — everything at once. This is a *view*, not a tool. Nobody navigates by it
  and that is fine; it is for the pleasure of seeing the shape of your own life, and for
  showing the system to other people. Worth being honest that it is decoration, because
  decoration budgeted as decoration is cheap and decoration mistaken for a feature is not.

Motivation is a legitimate design input for a personal system. A tool he enjoys opening is a
tool he keeps using, and that is not a soft argument when the failure mode under study is
abandonment.

**The one hard guard: the graph must never nag.** An Obsidian graph tempts its owner into
tidying — orphan nodes look like a mess that wants cleaning. That is filing in a costume,
and filing is the thing that kills these systems. So: no orphan counts, no connectedness
percentage, no completeness score, no "unlinked mentions" prompt. It renders what exists and
asks for nothing. Every earlier decision on this map removed a maintenance surface; this one
must not quietly add one back.

**Still not the front door.** Voice remains the way in. The graph is somewhere he goes when
he wants to look, never the thing that greets him.
