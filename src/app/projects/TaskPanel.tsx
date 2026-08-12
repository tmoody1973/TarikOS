"use client";

import { useState } from "react";
import { SlideOver } from "@/components/SlideOver";
import {
  workItemCode,
  workItemUrl,
  type BoardColumn,
  type PlaneWorkItem,
} from "@/lib/planeLib";

// One work item, opened.
//
// The board shows a title and a priority, which is enough to scan and not
// enough to act on. This is where a card becomes a thing you can change: read
// what it says, move it, reprioritise it, or go to Plane for the parts this
// board deliberately does not do.
//
// Built on the shared SlideOver — backdrop, Escape, focus, LCARS cap — rather
// than a second panel implementation. /mail and /briefs already use it.
//
// Every write goes back through /api/plane/board, the same route the board and
// Zola's tools use. The token stays server-side and there is one path that can
// change a work item, not two that must agree.

/** Plane's priorities, worst first. `none` is a real value, not an absence. */
const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;

export function TaskPanel({
  workItem,
  projectId,
  projectIdentifier,
  columns,
  onClose,
  onChanged,
}: {
  workItem: PlaneWorkItem | null;
  projectId: string;
  projectIdentifier: string;
  columns: BoardColumn[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function patch(body: Record<string, string>) {
    if (!workItem || busy) return;
    setBusy(true);
    setProblem(null);
    const res = await fetch("/api/plane/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: projectId, workItem: workItem.id, ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      // Named rather than swallowed. A silent no-op on a state change is
      // indistinguishable from a state change that worked.
      setProblem(detail.error ?? `Plane returned ${res.status}.`);
      return;
    }
    await onChanged();
    onClose();
  }

  // The state id for a column, resolved from the project's own states. Moving
  // by GROUP rather than by name, for the reason the board groups by group.
  const stateFor = (column: BoardColumn) => column.stateId;

  return (
    <SlideOver
      open={workItem !== null}
      onClose={onClose}
      accent="bg-hopbush"
      label={
        workItem
          ? workItemCode(projectIdentifier, workItem.sequence_id)
          : "Task"
      }
    >
      {workItem ? (
        <div className="flex flex-col gap-5">
          <h2 className="text-lg text-foreground">{workItem.name}</h2>

          {problem ? <p className="text-xs text-salmon">{problem}</p> : null}

          {workItem.description_stripped?.trim() ? (
            // Plain text, not description_html. Plane's editor output is
            // untrusted HTML and nothing here needs to render it.
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-steel">
              {workItem.description_stripped}
            </p>
          ) : (
            <p className="text-xs italic text-steel/60">No description.</p>
          )}

          <section>
            <h3 className="mb-2 text-[10px] uppercase tracking-[0.3em] text-steel">
              Move to
            </h3>
            <div className="flex flex-wrap gap-2">
              {columns.map((column) => {
                const here = column.group === workItem.state_group;
                const target = stateFor(column);
                return (
                  <button
                    key={column.group}
                    disabled={here || busy || !target}
                    onClick={() => void patch({ state: target! })}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] transition-colors focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-40 motion-reduce:transition-none ${
                      here
                        ? "border-hopbush bg-hopbush/15 text-hopbush"
                        : "border-panel-edge text-steel hover:border-hopbush hover:text-hopbush"
                    }`}
                  >
                    {column.name}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[10px] uppercase tracking-[0.3em] text-steel">
              Priority
            </h3>
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map((priority) => {
                const here = workItem.priority === priority;
                return (
                  <button
                    key={priority}
                    disabled={here || busy}
                    onClick={() => void patch({ priority })}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] transition-colors focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-40 motion-reduce:transition-none ${
                      here
                        ? "border-hopbush bg-hopbush/15 text-hopbush"
                        : "border-panel-edge text-steel hover:border-hopbush hover:text-hopbush"
                    }`}
                  >
                    {priority}
                  </button>
                );
              })}
            </div>
          </section>

          {/* "Never has to open Plane" is not "cannot". Comments, attachments,
              cycles and modules all live behind this link, and none of them are
              things this board pretends to do. */}
          <a
            href={workItemUrl(projectId, workItem.id)}
            target="_blank"
            rel="noreferrer"
            className="self-start rounded-md border border-panel-edge px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-hopbush hover:text-hopbush focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
          >
            Open in Plane ↗
          </a>
        </div>
      ) : null}
    </SlideOver>
  );
}
