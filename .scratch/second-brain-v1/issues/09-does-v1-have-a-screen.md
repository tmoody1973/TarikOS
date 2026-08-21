# 09 — Does v1 have a screen other than the graph

Type: grilling
Status: open
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
