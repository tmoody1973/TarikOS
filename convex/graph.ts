import { query } from "./_generated/server";
import { requireUser } from "./dashboard";

/**
 * The second brain as nodes and edges.
 *
 * The load-bearing property: **nothing here is inferred and nothing is stored**.
 * Every edge below is read off a column that already exists and already means
 * the relationship it is being asked to mean. That is why the graph is
 * populated on day one at zero cost, why there is no approval queue, and why
 * there is nothing to maintain. See ticket 02.
 *
 * The only edge a human writes is `blocks`, said out loud, and it has no
 * column yet — when it lands it joins this list rather than changing its shape.
 *
 * Nodes POINT at their canonical row and cache only a label. Nothing is
 * copied: the inspector fetches detail from the real table.
 */

/** Per-kind ceiling. The whole graph is a view, not a workbench — see ticket 07. */
const PER_KIND = 120;

/** How much of a row's text is a usable label at node size. */
const LABEL = 70;

const label = (s: string) => (s.length > LABEL ? `${s.slice(0, LABEL - 1)}…` : s);

export type GraphNode = {
  id: string;
  kind:
    | "decision"
    | "open_loop"
    | "memory"
    | "thought"
    | "goal"
    | "habit"
    | "document"
    | "conversation";
  label: string;
  at: number;
};

export type GraphEdge = { from: string; to: string; rel: string };

export const graph = query({
  args: {},
  handler: async (ctx): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> => {
    await requireUser(ctx);

    const [decisions, loops, memories, thoughts, telos, habits, documents, transcripts] =
      await Promise.all([
        ctx.db.query("decisions").order("desc").take(PER_KIND),
        ctx.db.query("openLoops").order("desc").take(PER_KIND),
        ctx.db.query("memories").order("desc").take(PER_KIND),
        ctx.db.query("thoughts").order("desc").take(PER_KIND),
        ctx.db.query("telosItems").order("desc").take(PER_KIND),
        ctx.db.query("habits").order("desc").take(PER_KIND),
        ctx.db.query("documents").order("desc").take(PER_KIND),
        ctx.db.query("transcripts").order("desc").take(PER_KIND),
      ]);

    const nodes: GraphNode[] = [
      ...decisions.map((d) => ({
        id: d._id as string,
        kind: "decision" as const,
        label: label(d.what),
        at: d.decidedAt,
      })),
      ...loops
        .filter((l) => l.status === "open")
        .map((l) => ({
          id: l._id as string,
          kind: "open_loop" as const,
          label: label(l.text),
          at: l.openedAt,
        })),
      ...memories.map((m) => ({
        id: m._id as string,
        kind: "memory" as const,
        label: label(m.content),
        at: m._creationTime,
      })),
      ...thoughts.map((t) => ({
        id: t._id as string,
        kind: "thought" as const,
        label: label(t.cleaned),
        at: t._creationTime,
      })),
      ...telos
        .filter((t) => t.status === "active")
        .map((t) => ({
          id: t._id as string,
          kind: "goal" as const,
          label: label(t.text),
          at: t._creationTime,
        })),
      ...habits.map((h) => ({
        id: h._id as string,
        kind: "habit" as const,
        label: label(h.identity),
        at: h._creationTime,
      })),
      ...documents.map((d) => ({
        id: d._id as string,
        kind: "document" as const,
        label: label(d.title),
        at: d.createdAt,
      })),
      ...transcripts.map((t) => ({
        id: t._id as string,
        kind: "conversation" as const,
        label: label(t.title),
        at: t._creationTime,
      })),
    ];

    const present = new Set(nodes.map((n) => n.id));
    const edges: GraphEdge[] = [];
    // An edge to a row that fell outside the per-kind ceiling would render as a
    // line into empty space, so both ends must be on screen.
    const link = (from: string, to: string | undefined | null, rel: string) => {
      if (to && present.has(from) && present.has(to)) edges.push({ from, to, rel });
    };

    for (const h of habits) link(h._id, h.telosItemId, "supports");
    for (const m of memories) link(m._id, m.transcriptId, "from");
    for (const t of thoughts) link(t._id, t.transcriptId, "from");
    for (const d of decisions) {
      link(d._id, d.transcriptId, "from");
      link(d._id, d.supersedes, "replaces");
    }
    for (const l of loops) link(l._id, l.transcriptId, "from");
    // A document's source is a brief or a Studio doc, neither of which is a node
    // here yet; the sourceId is kept as a string so this stays a one-line change
    // the day they are.
    for (const doc of documents) link(doc._id, doc.sourceId, "from");

    return { nodes, edges };
  },
});
