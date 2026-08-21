import type { GraphEdge, GraphNode } from "../../convex/graph";

/**
 * Where the nodes go. Deterministic arithmetic, no simulation.
 *
 * A force layout was the obvious choice and the wrong one. The single thing a
 * graph is good at is letting you recognise the same shape twice; a simulation
 * settles somewhere slightly different on every render and takes that away,
 * in exchange for prettiness on a graph that is a few dozen nodes wide.
 *
 * So: rings for the local view (the working tool — one focus, its neighbours,
 * their neighbours) and kind-clusters for the whole view (honestly budgeted as
 * decoration, ticket 07). No dependency, no physics, no jitter.
 */

const TAU = Math.PI * 2;

/** Fraction of the canvas each hop ring sits out at. */
const RINGS = [0, 0.26, 0.44];

export type Pos = { x: number; y: number };

/**
 * Who touches whom, both ways.
 *
 * Edges are undirected here on purpose: "this memory came from that
 * conversation" is one relationship, and walking only the arrow shows half the
 * neighbourhood.
 */
function adjacency(edges: readonly GraphEdge[]): Map<string, string[]> {
  const near = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const list = near.get(a);
    if (list) list.push(b);
    else near.set(a, [b]);
  };
  for (const e of edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return near;
}

/** Hop distance from the focus, for ring placement and for dimming. */
export function hopDepth(
  edges: readonly GraphEdge[],
  focusId: string,
  max: number,
): Map<string, number> {
  const near = adjacency(edges);
  const depth = new Map<string, number>([[focusId, 0]]);
  let frontier = [focusId];
  for (let h = 1; h <= max; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of near.get(id) ?? []) {
        if (!depth.has(n)) {
          depth.set(n, h);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * Everything within `hops` of the focus, the focus included.
 *
 * Never empty and never an error: an unconnected node is a normal thing to look
 * at, so it is its own neighbourhood of one.
 */
export function neighborhood(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  focusId: string,
  hops: number,
): GraphNode[] {
  const depth = hopDepth(edges, focusId, hops);
  return nodes.filter((n) => depth.has(n.id));
}

/**
 * Positions for every node, inside a square canvas of `size`.
 *
 * With a focus: concentric rings, focus dead centre.
 * Without:      one cluster per kind, kinds spread around the canvas, so the
 *               whole graph reads as regions rather than as a hairball.
 */
export function layout(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  focusId: string | null,
  size: number,
): Map<string, Pos> {
  const c = size / 2;
  const pos = new Map<string, Pos>();
  if (nodes.length === 0) return pos;

  if (focusId) {
    const depth = hopDepth(edges, focusId, RINGS.length - 1);
    const byRing = new Map<number, GraphNode[]>();
    for (const n of nodes) {
      const d = Math.min(depth.get(n.id) ?? RINGS.length - 1, RINGS.length - 1);
      const ring = byRing.get(d);
      if (ring) ring.push(n);
      else byRing.set(d, [n]);
    }
    for (const [ring, members] of byRing) {
      const r = RINGS[ring] * size;
      if (r === 0) {
        for (const m of members) pos.set(m.id, { x: c, y: c });
        continue;
      }
      // Offset each ring by half a step so ring 2 does not hide behind ring 1.
      const offset = (ring * Math.PI) / members.length;
      members.forEach((m, i) => {
        const a = (i / members.length) * TAU + offset;
        pos.set(m.id, { x: c + r * Math.cos(a), y: c + r * Math.sin(a) });
      });
    }
    return pos;
  }

  const kinds = [...new Set(nodes.map((n) => n.kind))].sort();
  kinds.forEach((kind, k) => {
    const members = nodes.filter((n) => n.kind === kind);
    const a = (k / kinds.length) * TAU;
    const cx = c + 0.3 * size * Math.cos(a);
    const cy = c + 0.3 * size * Math.sin(a);
    // A phyllotaxis spiral: even density, no overlap, and the same every time.
    members.forEach((m, i) => {
      const r = 0.014 * size * Math.sqrt(i);
      const t = i * 2.399963229728653;
      pos.set(m.id, {
        x: clamp(cx + r * Math.cos(t), 0, size),
        y: clamp(cy + r * Math.sin(t), 0, size),
      });
    });
  });
  return pos;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
