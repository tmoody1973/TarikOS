import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphEdge, GraphNode } from "../../convex/graph";
import { seedPositions } from "./graphLayout";

/**
 * The physics behind the graph.
 *
 * Tarik's call, and it is in ticket 07 in his words: "I would like to keep the
 * graph like Obsidian." What makes an Obsidian graph feel alive is not the
 * renderer — it is that the dots push each other apart, the links pull, and the
 * whole web follows your hand when you drag one.
 *
 * The one real cost of a simulation is that it settles somewhere slightly
 * different every time, so the shape never becomes familiar. That cost is paid
 * off by seeding the START from a hash of each node's id (see seedPositions):
 * same graph, same settle, still alive. The only remaining source of drift is
 * d3's internal jiggle, which fires when two nodes land on exactly the same
 * point — vanishingly rare with hashed seeds.
 */

export type SimNode = SimulationNodeDatum & GraphNode;
export type SimLink = { source: string | SimNode; target: string | SimNode; rel: string };

/** Past this the browser stops feeling responsive under a drag. */
export const MAX_NODES = 400;

export function buildSimulation(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  size: number,
  focusId: string | null,
): { sim: Simulation<SimNode, undefined>; nodes: SimNode[]; links: SimLink[] } {
  const seeds = seedPositions(nodes, size);
  const simNodes: SimNode[] = nodes.map((n) => ({ ...n, ...seeds[n.id] }));
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const links: SimLink[] = edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => ({ source: e.from, target: e.to, rel: e.rel }));

  // The focused node is pinned at the centre. Everything else arranges itself
  // around it, which is what makes the local view readable without a legend.
  if (focusId) {
    const f = byId.get(focusId);
    if (f) {
      f.fx = size / 2;
      f.fy = size / 2;
    }
  }

  const sim = forceSimulation<SimNode>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(70)
        .strength(0.35),
    )
    // Repulsion scaled down as the graph grows, or the whole graph explodes off
    // canvas the moment a few hundred memories exist.
    .force("charge", forceManyBody<SimNode>().strength(-140 / Math.max(1, Math.sqrt(simNodes.length / 40))))
    .force("center", forceCenter(size / 2, size / 2))
    .alphaDecay(0.035)
    .stop();

  return { sim, nodes: simNodes, links };
}

/** Nodes worth simulating: the focused neighbourhood, or the newest MAX_NODES. */
export function capped(nodes: readonly GraphNode[]): GraphNode[] {
  if (nodes.length <= MAX_NODES) return [...nodes];
  return [...nodes].sort((a, b) => b.at - a.at).slice(0, MAX_NODES);
}
