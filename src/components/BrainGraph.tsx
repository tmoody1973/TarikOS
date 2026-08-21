"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { GraphEdge, GraphNode } from "../../convex/graph";
import { hopDepth, layout, neighborhood } from "@/lib/graphLayout";
import { ZoneEmpty } from "@/components/hud/Zone";

/**
 * The graph, as an LCARS sensor plot.
 *
 * Two modes, and they are not the same tool. LOCAL is the working one — one
 * thing, what it touches, and what those touch, which is the shape of the
 * question he actually asks. WHOLE is a view; it was kept because he wants it
 * and it costs almost nothing on top of local, and it is budgeted honestly as
 * decoration (ticket 07).
 *
 * The node inspector IS the detail view. There is no separate screen.
 *
 * What is deliberately absent: orphan counts, a connectedness percentage, an
 * unlinked-mentions prompt. Tidying a graph is filing in a costume, and it is
 * the chore that kills every system like this by week six.
 */

const SIZE = 900;
const HOPS = 2;

/** One colour per kind, from the existing rail palette — no new hues. */
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

  // A hint from Zola ("focus the graph on the Telnyx decision") is matched the
  // same way he would match it — by eye, on the label — and only when it is
  // unambiguous enough to be worth doing silently.
  const hinted = useMemo(() => {
    if (!focusHint || !data) return null;
    const q = focusHint.toLowerCase();
    const hits = data.nodes.filter((n) => n.label.toLowerCase().includes(q));
    return hits.length === 1 ? hits[0].id : null;
  }, [focusHint, data]);

  const active = focus ?? hinted;

  const view = useMemo(() => {
    if (!data) return null;
    const nodes = active
      ? neighborhood(data.nodes, data.edges, active, HOPS)
      : data.nodes;
    const ids = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    return { nodes, edges, pos: layout(nodes, edges, active, SIZE) };
  }, [data, active]);

  const depth = useMemo(
    () => (data && active ? hopDepth(data.edges, active, HOPS) : null),
    [data, active],
  );

  if (data === undefined) return <ZoneEmpty>plotting…</ZoneEmpty>;
  if (!view || view.nodes.length === 0) {
    return <ZoneEmpty>Nothing to plot yet — the graph fills as Zola captures.</ZoneEmpty>;
  }

  const node = (id: string | null) =>
    id ? (view.nodes.find((n) => n.id === id) ?? null) : null;
  const chosen = node(selected);
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
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {kinds.map((k) => (
            <span
              key={k}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-steel"
            >
              <i
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: KIND_COLOR[k] }}
              />
              {KIND_LABEL[k]}
            </span>
          ))}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_18rem]">
        <div className="min-h-80 overflow-hidden rounded-md border border-panel-edge bg-black/40">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-full w-full"
            role="img"
            aria-label={active ? "Local graph around the focused node" : "Whole second brain graph"}
          >
            <g stroke="var(--panel-edge)" strokeWidth={1.5}>
              {view.edges.map((e, i) => (
                <Edge key={i} edge={e} pos={view.pos} />
              ))}
            </g>
            {view.nodes.map((n) => {
              const p = view.pos.get(n.id);
              if (!p) return null;
              const d = depth?.get(n.id) ?? 0;
              const isFocus = n.id === active;
              const r = isFocus ? 9 : d === 1 ? 6 : 4.5;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x} ${p.y})`}
                  className="cursor-pointer"
                  onClick={() => setSelected(n.id)}
                  onDoubleClick={() => {
                    setFocus(n.id);
                    setSelected(n.id);
                  }}
                >
                  <circle
                    r={r}
                    fill={KIND_COLOR[n.kind]}
                    opacity={selected && selected !== n.id ? 0.45 : 1}
                  />
                  {isFocus && (
                    <circle r={r + 6} fill="none" stroke="var(--hud-cyan)" strokeWidth={1} />
                  )}
                  {n.id === selected && (
                    <circle r={r + 3} fill="none" stroke="var(--hud-cyan)" strokeWidth={1.5} />
                  )}
                  {(isFocus || d === 1 || view.nodes.length < 40) && (
                    <text
                      x={r + 5}
                      y={3.5}
                      className="font-[family-name:var(--font-mono-hud)]"
                      fill="var(--foreground)"
                      fontSize={11}
                      opacity={0.75}
                    >
                      {n.label.slice(0, 34)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="min-h-0 overflow-y-auto rounded-md border border-panel-edge bg-black/20 p-3">
          {chosen === null ? (
            <p className="text-sm italic text-steel">
              Click a node to read it. Double-click to walk out from it.
            </p>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-[0.3em]" style={{ color: KIND_COLOR[chosen.kind] }}>
                {KIND_LABEL[chosen.kind].replace(/s$/, "")}
              </p>
              <p className="mt-2 text-sm text-foreground/90 [overflow-wrap:anywhere]">
                {chosen.label}
              </p>
              <Connections node={chosen} edges={view.edges} nodes={view.nodes} />
              {chosen.id !== active && (
                <button
                  onClick={() => setFocus(chosen.id)}
                  className="mt-4 w-full rounded-md border border-panel-edge px-2 py-1 text-[10px] uppercase tracking-wider text-steel transition hover:border-cyan-hud/50 hover:text-foreground"
                >
                  walk out from here
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Edge({ edge, pos }: { edge: GraphEdge; pos: Map<string, { x: number; y: number }> }) {
  const a = pos.get(edge.from);
  const b = pos.get(edge.to);
  if (!a || !b) return null;
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
}

function Connections({
  node,
  edges,
  nodes,
}: {
  node: GraphNode;
  edges: readonly GraphEdge[];
  nodes: readonly GraphNode[];
}) {
  const touching = edges.filter((e) => e.from === node.id || e.to === node.id);
  if (touching.length === 0) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <ul className="mt-3 space-y-1.5 border-t border-panel-edge pt-3">
      {touching.map((e, i) => {
        const otherId = e.from === node.id ? e.to : e.from;
        const other = byId.get(otherId);
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
  );
}
