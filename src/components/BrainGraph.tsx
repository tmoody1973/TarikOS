"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { GraphEdge, GraphNode } from "../../convex/graph";
import { neighborhood } from "@/lib/graphLayout";
import { buildSimulation, capped, MAX_NODES, type SimLink, type SimNode } from "@/lib/graphSim";
import { ZoneEmpty } from "@/components/hud/Zone";

/**
 * The graph, with physics.
 *
 * Two modes, and they are not the same tool. LOCAL is the working one — one
 * thing, what it touches, and what those touch, which is the shape of the
 * question he actually asks. WHOLE is a view, budgeted honestly as decoration
 * (ticket 07). The node inspector IS the detail view; there is no third screen.
 *
 * What is deliberately absent: orphan counts, a connectedness percentage, an
 * unlinked-mentions prompt. Tidying a graph is filing in a costume, and filing
 * is the thing that kills systems like this by week six.
 */

const SIZE = 900;
const HOPS = 2;

const KIND_COLOR: Record<GraphNode["kind"], string> = {
  decision: "var(--lcars-amber)",
  open_loop: "var(--lcars-salmon)",
  memory: "var(--lcars-lavender)",
  thought: "var(--lcars-blue)",
  goal: "var(--lcars-sage)",
  habit: "var(--lcars-ochre)",
  document: "var(--lcars-hopbush)",
  conversation: "var(--lcars-steel)",
};

const KIND_LABEL: Record<GraphNode["kind"], string> = {
  decision: "decisions",
  open_loop: "open loops",
  memory: "memories",
  thought: "thoughts",
  goal: "goals",
  habit: "habits",
  document: "documents",
  conversation: "conversations",
};

export function BrainGraph({ focusHint }: { focusHint?: string }) {
  const data = useQuery(api.graph.graph);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const hinted = useMemo(() => {
    if (!focusHint || !data) return null;
    const q = focusHint.toLowerCase();
    const hits = data.nodes.filter((n) => n.label.toLowerCase().includes(q));
    return hits.length === 1 ? hits[0].id : null;
  }, [focusHint, data]);
  const active = focus ?? hinted;

  const view = useMemo(() => {
    if (!data) return null;
    const scoped = active
      ? neighborhood(data.nodes, data.edges, active, HOPS)
      : capped(data.nodes);
    const ids = new Set(scoped.map((n) => n.id));
    return {
      nodes: scoped,
      edges: data.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
      truncated: !active && data.nodes.length > MAX_NODES,
      total: data.nodes.length,
    };
  }, [data, active]);

  if (data === undefined) return <ZoneEmpty>plotting…</ZoneEmpty>;
  if (!view || view.nodes.length === 0) {
    return <ZoneEmpty>Nothing to plot yet — the graph fills as Zola captures.</ZoneEmpty>;
  }

  const kinds = [...new Set(view.nodes.map((n) => n.kind))].sort();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.3em] text-steel">
          {active ? `local · ${HOPS} hops` : "whole"}
        </span>
        {active && (
          <button
            onClick={() => {
              setFocus(null);
              setSelected(null);
            }}
            className="rounded-full border border-panel-edge px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-steel transition hover:border-cyan-hud/50 hover:text-foreground"
          >
            show whole graph
          </button>
        )}
        {view.truncated && (
          // Said out loud rather than silently dropped. A view that quietly
          // shows 400 of 900 reads as "this is everything", which is a lie.
          <span className="text-[10px] uppercase tracking-wider text-steel/70">
            newest {MAX_NODES} of {view.total}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {kinds.map((k) => (
            <span key={k} className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-steel">
              <i aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_18rem]">
        <Canvas
          nodes={view.nodes}
          edges={view.edges}
          focus={active}
          selected={selected}
          hovered={hovered}
          onSelect={setSelected}
          onFocus={(id) => {
            setFocus(id);
            setSelected(id);
          }}
          onHover={setHovered}
        />
        <Inspector
          node={view.nodes.find((n) => n.id === selected) ?? null}
          nodes={view.nodes}
          edges={view.edges}
          isFocus={selected === active}
          onFocus={setFocus}
        />
      </div>
    </div>
  );
}

/**
 * The simulation, the pan/zoom frame, and the drag handling.
 *
 * Positions live in a ref and are copied into state once per animation frame.
 * Storing them in state directly would queue one React render per tick per
 * node, which stalls the drag it is supposed to make smooth.
 */
function Canvas({
  nodes,
  edges,
  focus,
  selected,
  hovered,
  onSelect,
  onFocus,
  onHover,
}: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  focus: string | null;
  selected: string | null;
  hovered: string | null;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const [, setFrame] = useState(0);
  const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ id: string | null; panFrom: { x: number; y: number } | null }>({
    id: null,
    panFrom: null,
  });

  useEffect(() => {
    const { sim, nodes: simNodes, links } = buildSimulation(nodes, edges, SIZE, focus);
    simNodesRef.current = simNodes;
    linksRef.current = links;
    let raf = 0;
    const loop = () => {
      // Several ticks per frame while it is still hot: the settle looks like
      // motion rather than a slideshow, and it finishes in about a second.
      for (let i = 0; i < 2 && sim.alpha() > sim.alphaMin(); i++) sim.tick();
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      sim.stop();
    };
  }, [nodes, edges, focus]);

  const toGraph = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      const sx = ((e.clientX - r.left) / r.width) * SIZE;
      const sy = ((e.clientY - r.top) / r.height) * SIZE;
      return { x: (sx - camera.x) / camera.k, y: (sy - camera.y) / camera.k };
    },
    [camera],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag.id) {
      const p = toGraph(e);
      const n = simNodesRef.current.find((s) => s.id === drag.id);
      if (n) {
        n.fx = p.x;
        n.fy = p.y;
      }
    } else if (drag.panFrom) {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      const sx = ((e.clientX - r.left) / r.width) * SIZE;
      const sy = ((e.clientY - r.top) / r.height) * SIZE;
      setCamera((c) => ({ ...c, x: c.x + (sx - drag.panFrom!.x), y: c.y + (sy - drag.panFrom!.y) }));
      drag.panFrom = { x: sx, y: sy };
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag.id && drag.id !== focus) {
      // Released nodes rejoin the physics. The focused one stays pinned — it is
      // the thing being looked at, and a centre that wanders is not a centre.
      const n = simNodesRef.current.find((s) => s.id === drag.id);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
    }
    dragRef.current = { id: null, panFrom: null };
  };

  const near = useMemo(() => {
    if (!hovered) return null;
    const s = new Set<string>([hovered]);
    for (const e of edges) {
      if (e.from === hovered) s.add(e.to);
      if (e.to === hovered) s.add(e.from);
    }
    return s;
  }, [hovered, edges]);

  return (
    <div className="relative min-h-80 overflow-hidden rounded-md border border-panel-edge bg-black/40">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label={focus ? "Local graph around the focused node" : "Whole second brain graph"}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={() => {
          endDrag();
          onHover(null);
        }}
        onPointerDown={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          if (!r) return;
          dragRef.current = {
            id: null,
            panFrom: {
              x: ((e.clientX - r.left) / r.width) * SIZE,
              y: ((e.clientY - r.top) / r.height) * SIZE,
            },
          };
        }}
        onWheel={(e) => {
          const r = svgRef.current?.getBoundingClientRect();
          if (!r) return;
          const sx = ((e.clientX - r.left) / r.width) * SIZE;
          const sy = ((e.clientY - r.top) / r.height) * SIZE;
          setCamera((c) => {
            const k = Math.min(4, Math.max(0.3, c.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
            // Zoom toward the pointer, not the corner, so the thing under the
            // cursor stays under the cursor.
            return { k, x: sx - ((sx - c.x) / c.k) * k, y: sy - ((sy - c.y) / c.k) * k };
          });
        }}
      >
        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
          <g stroke="var(--panel-edge)" strokeWidth={1.5}>
            {linksRef.current.map((l, i) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              if (typeof s === "string" || typeof t === "string") return null;
              const lit = !near || (near.has(s.id) && near.has(t.id));
              return (
                <line
                  key={i}
                  x1={s.x ?? 0}
                  y1={s.y ?? 0}
                  x2={t.x ?? 0}
                  y2={t.y ?? 0}
                  opacity={lit ? 1 : 0.15}
                />
              );
            })}
          </g>
          {simNodesRef.current.map((n) => {
            const isFocus = n.id === focus;
            const r = isFocus ? 9 : 5.5;
            const lit = !near || near.has(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${n.x ?? 0} ${n.y ?? 0})`}
                className="cursor-grab"
                opacity={lit ? 1 : 0.18}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = { id: n.id, panFrom: null };
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                }}
                onPointerEnter={() => onHover(n.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(n.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onFocus(n.id);
                }}
              >
                <circle r={r} fill={KIND_COLOR[n.kind]} />
                {isFocus && <circle r={r + 6} fill="none" stroke="var(--hud-cyan)" strokeWidth={1} />}
                {n.id === selected && <circle r={r + 3} fill="none" stroke="var(--hud-cyan)" strokeWidth={1.5} />}
                {(isFocus || hovered === n.id || simNodesRef.current.length < 45) && (
                  <text
                    x={r + 5}
                    y={3.5}
                    className="pointer-events-none font-[family-name:var(--font-mono-hud)]"
                    fill="var(--foreground)"
                    fontSize={11}
                    opacity={0.8}
                  >
                    {n.label.slice(0, 34)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <p className="pointer-events-none absolute bottom-1.5 left-2 text-[10px] uppercase tracking-wider text-steel/50">
        drag a node · scroll to zoom · double-click to walk out
      </p>
    </div>
  );
}

function Inspector({
  node,
  nodes,
  edges,
  isFocus,
  onFocus,
}: {
  node: GraphNode | null;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  isFocus: boolean;
  onFocus: (id: string) => void;
}) {
  if (node === null) {
    return (
      <aside className="min-h-0 overflow-y-auto rounded-md border border-panel-edge bg-black/20 p-3">
        <p className="text-sm italic text-steel">
          Click a node to read it. Double-click to walk out from it.
        </p>
      </aside>
    );
  }
  const touching = edges.filter((e) => e.from === node.id || e.to === node.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <aside className="min-h-0 overflow-y-auto rounded-md border border-panel-edge bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-[0.3em]" style={{ color: KIND_COLOR[node.kind] }}>
        {KIND_LABEL[node.kind].replace(/s$/, "")}
      </p>
      <p className="mt-2 text-sm text-foreground/90 [overflow-wrap:anywhere]">{node.label}</p>
      {touching.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-panel-edge pt-3">
          {touching.map((e, i) => {
            const other = byId.get(e.from === node.id ? e.to : e.from);
            if (!other) return null;
            return (
              <li key={i} className="text-xs text-foreground/70 [overflow-wrap:anywhere]">
                <span className="text-[10px] uppercase tracking-wider text-steel">
                  {e.from === node.id ? e.rel : `${e.rel} ←`}
                </span>{" "}
                {other.label}
              </li>
            );
          })}
        </ul>
      )}
      {!isFocus && (
        <button
          onClick={() => onFocus(node.id)}
          className="mt-4 w-full rounded-md border border-panel-edge px-2 py-1 text-[10px] uppercase tracking-wider text-steel transition hover:border-cyan-hud/50 hover:text-foreground"
        >
          walk out from here
        </button>
      )}
    </aside>
  );
}
