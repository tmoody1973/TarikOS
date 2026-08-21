# 09 — Does v1 have a screen other than the graph

Type: grilling
Status: resolved
Blocked by: —

## Question

Graduated from the fog once the earlier decisions cleared it. The PRD proposed five
surfaces — Now, Recall, Review, Map, Areas — and four of them have been quietly dismantled
by decisions on this map:

- **Areas** dropped to a tag (01), so it is not a screen.
- **Review** has nothing to review (02, 04, 05) — the queue starts and stays empty.
- **Map** is in, as a local graph plus a whole-graph view (07).
- **Recall** happens by voice, since voice is the front door.

That leaves **Now** — and the awkward fact that the morning brief already does what Now was
specified to do. It answers what to focus on, what is scheduled, what is at risk, and it
arrives spoken, on a cron, without him opening anything.

So: does v1 ship any screen beyond the graph? The options are a Now screen (accepting it
overlaps the brief), the graph alone, or the graph plus a plain inspector reachable from
recall results — somewhere for "open the decision she just cited" to land.

Note the third option may be forced rather than chosen: if she cites a decision by voice,
he needs somewhere to look at it.

## Answer

**One new screen: the graph. Everything else already exists or was deleted by an earlier
decision.**

The PRD's five surfaces resolve like this:

- **Areas** became a tag in ticket 01. Not a screen.
- **Review** has nothing to review after 02, 04 and 05. Deleted, not deferred.
- **Recall** is voice, because voice is the front door.
- **Now** already exists as the `briefs` page. The morning brief answers what to focus on,
  what is scheduled and what is at risk — spoken, on a cron, without him opening anything.
  Building a Now screen would be building a worse copy of a thing that already works and
  that he already uses daily.
- **Map** is the single surface that gets built.

**The detail view solves itself**, which is what forced this ticket. If she cites a decision
by voice, he needs somewhere to look at it — and the graph's node inspector already is that
place: rationale, sources, status, what it superseded, what connects to it. A separate
detail screen would duplicate the inspector.

**And that unlocks the arrangement the PRD was reaching for.** `navigate_ui` already exists
and can push a page to his browser mid-conversation; it already knows home, briefs, brain,
telos, mail, habits, conversations and control. So she can answer *and* place the thing in
front of him in the same breath — "you decided in March the portfolio was the main proof,
it's on your screen." Voice for talking, screen for detail, achieved with one new surface
rather than five.

**Build cost:** one graph page inside the existing `brain` route, plus one new target for
`navigate_ui` so she can focus it on a specific node.
