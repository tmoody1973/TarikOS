"use client";

import { useCallback, useEffect, useState } from "react";
import { Authenticated, AuthLoading, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { ZoneEmpty } from "@/components/hud/Zone";
import { TaskPanel } from "./TaskPanel";
import type { BoardColumn, PlaneProject, PlaneWorkItem, StateGroup } from "@/lib/planeLib";

// Projects. The board Tarik works in, so he never opens plane.so.
//
// Hopbush — a new channel. Execution is not a document and does not join the
// lavender BRIEFS/MAIL/DOCS family, nor ochre, which Studio took today.
//
// Reads through /api/plane/board rather than calling Plane: the API token is
// server-side and must never reach a browser. There is deliberately no Convex
// mirror of projects or work items — Plane owns them, and a copy here is a copy
// that can disagree. The one thing Convex holds is which project is the default
// for a quick todo.
//
// Below lg the five columns collapse to one with a filter. Five columns at
// 375px is five unusable columns, the same rule /mail and /contacts follow.

type Board = { projects: PlaneProject[]; columns: BoardColumn[] | null };

const GROUP_LABEL: Record<StateGroup, string> = {
  backlog: "BACKLOG",
  unstarted: "TODO",
  started: "IN PROGRESS",
  completed: "DONE",
  cancelled: "CANCELLED",
};

export default function ProjectsPage() {
  return (
    <>
      <Authenticated>
        <ProjectsInner />
      </Authenticated>
      <AuthLoading>
        <div className="flex flex-1 items-center justify-center">
          <p className="pulse-soft font-[family-name:var(--font-mono-hud)] text-xs tracking-[0.3em] text-steel">
            ZOLA · AUTHENTICATING…
          </p>
        </div>
      </AuthLoading>
    </>
  );
}

function ProjectsInner() {
  const preferred = useQuery(api.planeSettings.get, {});
  const [board, setBoard] = useState<Board | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState<StateGroup | "all">("all");
  const [open, setOpen] = useState<PlaneWorkItem | null>(null);

  const load = useCallback(async (id: string | null) => {
    setProblem(null);
    const res = await fetch(`/api/plane/board${id ? `?project=${id}` : ""}`);
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      // Said out loud rather than rendered as an empty board. An empty board
      // means "no work"; a 401 means "the token is wrong", and they must never
      // look the same.
      setProblem(detail.error ?? `Plane returned ${res.status}.`);
      return;
    }
    setBoard((await res.json()) as Board);
  }, []);

  useEffect(() => {
    void load(projectId);
  }, [load, projectId]);

  // Open on the project quick todos go to, so the page lands where his own
  // list is rather than on whatever Plane returns first.
  useEffect(() => {
    if (projectId === null && preferred?.projectId) setProjectId(preferred.projectId);
  }, [preferred, projectId]);

  async function addTask() {
    if (!projectId || !title.trim() || busy) return;
    setBusy(true);
    const res = await fetch("/api/plane/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: projectId, title }),
    });
    setBusy(false);
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      setProblem(detail.error ?? "That task wasn't created.");
      return;
    }
    setTitle("");
    await load(projectId);
  }

  const columns = board?.columns ?? [];
  const shown = columns.filter((c) => only === "all" || c.group === only);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      {/* A header strip, not a Zone. A Zone carries min-h-64 — right for a
          dashboard panel, and 256px stolen from a board that needs every pixel
          of height it can get. The document page uses the same idiom. */}
      <header className="shrink-0 rounded-lg border border-panel-edge bg-panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="lcars-cap-left h-4 w-10 shrink-0 bg-hopbush" />
          <h1 className="font-[family-name:var(--font-display)] text-sm uppercase tracking-[0.35em] text-foreground/90">
            Projects
          </h1>
          {(board?.projects ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => setProjectId(p.id)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] transition-colors focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none ${
                projectId === p.id
                  ? "border-hopbush bg-hopbush/15 text-hopbush"
                  : "border-panel-edge text-steel hover:text-foreground"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {problem ? <p className="mt-2 text-xs text-salmon">{problem}</p> : null}

        <div className="mt-2 flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addTask();
            }}
            placeholder="What needs doing?"
            aria-label="New task"
            disabled={!projectId}
            className="min-w-0 flex-1 rounded-md border border-panel-edge bg-black/20 px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-steel/60 focus:border-hopbush disabled:opacity-40"
          />
          <button
            onClick={() => void addTask()}
            disabled={!projectId || !title.trim() || busy}
            className="rounded-md border border-hopbush px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-hopbush transition-colors hover:bg-hopbush hover:text-black focus-visible:outline-2 focus-visible:outline-cyan-hud disabled:opacity-40 motion-reduce:transition-none"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </header>

      {/* Below lg the board is one column at a time. Five columns at 375px is
          five unusable columns. */}
      <div className="flex flex-wrap gap-2 lg:hidden">
        {(["all", ...columns.map((c) => c.group)] as const).map((g) => (
          <button
            key={g}
            onClick={() => setOnly(g as StateGroup | "all")}
            className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] ${
              only === g
                ? "border-hopbush bg-hopbush/15 text-hopbush"
                : "border-panel-edge text-steel"
            }`}
          >
            {g === "all" ? "ALL" : GROUP_LABEL[g as StateGroup]}
          </button>
        ))}
      </div>

      {board === null ? (
        <p className="pulse-soft text-xs tracking-[0.3em] text-steel">LOADING…</p>
      ) : !projectId ? (
        <ZoneEmpty>Pick a project above.</ZoneEmpty>
      ) : (
        <div className="grid min-h-0 flex-1 gap-2 overflow-x-auto lg:grid-cols-5">
          {shown.map((column) => (
            <section
              key={column.group}
              className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-panel-edge bg-panel"
            >
              <h2 className="flex items-baseline gap-2 border-b border-panel-edge px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-hopbush">
                {/* The project's own word for this column, not the group's —
                    a renamed column should read the way Plane reads. */}
                {column.name}
                <span className="ml-auto text-steel">{column.items.length}</span>
              </h2>
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {column.items.map((workItem) => (
                  <li key={workItem.id}>
                    {/* A button, not a div with onClick. A card is an action,
                        so it has to be reachable and operable from a keyboard
                        like every other action on this page. */}
                    <button
                      onClick={() => setOpen(workItem)}
                      className="w-full rounded-md border border-panel-edge bg-black/20 px-2.5 py-2 text-left transition-colors hover:border-hopbush/60 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
                    >
                      <p className="text-xs text-foreground">{workItem.name}</p>
                      <p className="mt-1 text-[10px] tracking-[0.2em] text-steel">
                        {workItem.priority !== "none" ? workItem.priority.toUpperCase() : ""}
                      </p>
                    </button>
                  </li>
                ))}
                {column.items.length === 0 ? (
                  <li className="text-[10px] uppercase tracking-[0.3em] text-steel/50">Empty</li>
                ) : null}
              </ul>
            </section>
          ))}
        </div>
      )}
      <TaskPanel
        workItem={open}
        projectId={projectId ?? ""}
        projectIdentifier={
          (board?.projects ?? []).find((p) => p.id === projectId)?.identifier ?? ""
        }
        columns={columns}
        onClose={() => setOpen(null)}
        onChanged={() => load(projectId)}
      />
    </div>
  );
}
