"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { StreamItem, StreamKind } from "../../convex/brainStream";
import { ago, groupByBucket } from "@/lib/brainStream";
import { ZoneEmpty } from "@/components/hud/Zone";

/**
 * What Zola thinks she knows, newest first, with a way to correct it.
 *
 * This replaced three columns split by which table a row lived in. That split
 * was the database showing through: nobody wonders whether something was a
 * memory or a thought. What he wonders is whether she has something wrong —
 * and that question is ordered by time.
 *
 * Correcting her is the one chore in this system that pays for itself. An
 * uncorrected wrong memory gets repeated back as fact forever, so edit and
 * delete are one click, on every row, with no confirmation dialogue.
 */

const KIND_COLOR: Record<StreamKind, string> = {
  decision: "var(--lcars-amber)",
  open_loop: "var(--lcars-salmon)",
  fact: "var(--lcars-lavender)",
  preference: "var(--lcars-lavender)",
  project: "var(--lcars-ochre)",
  person: "var(--lcars-hopbush)",
  thought: "var(--lcars-blue)",
  capture: "var(--lcars-sage)",
  reflection: "var(--lcars-sage)",
};

const FILTERS = [
  { key: "all", label: "everything", kinds: null },
  { key: "decisions", label: "decisions", kinds: ["decision"] },
  { key: "loops", label: "open loops", kinds: ["open_loop"] },
  {
    key: "learned",
    label: "what she learned",
    kinds: ["fact", "preference", "project", "person"],
  },
  { key: "mine", label: "my own words", kinds: ["thought", "capture", "reflection"] },
] as const;

export function BrainStream({ search }: { search: string }) {
  const items = useQuery(api.brainStream.stream);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  // Rendered once per mount rather than per row: Date.now() inside a map makes
  // every row a different "now" and re-renders churn the labels.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [items]);

  const dashboardSearch = useAction(api.memoryOps.dashboardSearch);
  const [hits, setHits] = useState<Set<string> | null>(null);
  const latest = useRef("");
  useEffect(() => {
    const q = search.trim();
    latest.current = q;
    if (!q) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      dashboardSearch({ searchQuery: q })
        .then((res) => {
          if (latest.current !== q) return;
          setHits(
            new Set([
              ...res.thoughts.map((t) => t._id as string),
              ...res.memories.map((m) => m._id as string),
              ...res.journal.map((j) => j._id as string),
            ]),
          );
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [search, dashboardSearch]);

  const groups = useMemo(() => {
    if (!items || now === null) return null;
    const active = FILTERS.find((f) => f.key === filter)!;
    let shown = active.kinds
      ? items.filter((i) => (active.kinds as readonly string[]).includes(i.kind))
      : items;
    if (hits) {
      // Semantic search only indexes three of the five stores. Falling back to
      // a substring match on the rest beats hiding them, which would read as
      // "she has nothing on that" when she does.
      const q = search.trim().toLowerCase();
      shown = shown.filter(
        (i) => hits.has(i.id) || i.text.toLowerCase().includes(q),
      );
    }
    return groupByBucket(shown, now);
  }, [items, now, filter, hits, search]);

  if (items === undefined || groups === null || now === null)
    return <ZoneEmpty>syncing…</ZoneEmpty>;

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 pb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition ${
              filter === f.key
                ? "border-lavender/70 bg-lavender/15 text-foreground"
                : "border-panel-edge text-steel hover:border-lavender/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {total === 0 ? (
        <ZoneEmpty>
          {search.trim() ? "Nothing matches that." : "Nothing yet — she fills this as you talk."}
        </ZoneEmpty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {groups.map((g) => (
            <section key={g.bucket} className="mb-5">
              <h3 className="sticky top-0 z-10 flex items-center gap-3 bg-panel/95 py-1 text-[10px] uppercase tracking-[0.3em] text-steel backdrop-blur">
                {g.bucket}
                <span className="h-px flex-1 bg-panel-edge" />
                <span className="text-steel/60">{g.items.length}</span>
              </h3>
              <ul className="mt-1">
                {g.items.map((item) => (
                  <Row key={item.id} item={item} now={now} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ item, now }: { item: StreamItem; now: number }) {
  const editItem = useMutation(api.brainStream.editItem);
  const deleteItem = useMutation(api.brainStream.deleteItem);
  const closeLoop = useMutation(api.brainStream.closeLoopById);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await editItem({ table: item.table, id: item.id, text: draft });
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    }
  };

  return (
    <li className="group border-b border-panel-edge/50 py-2.5 last:border-0">
      <div className="flex items-baseline gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.2em]"
          style={{ color: KIND_COLOR[item.kind] }}
        >
          {item.kind.replace("_", " ")}
        </span>
        <span className="text-[10px] text-steel">{ago(item.at, now)}</span>
        <span className="ml-auto flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {item.table === "openLoops" && (
            <button
              onClick={() => closeLoop({ id: item.id as never })}
              className="text-[10px] uppercase tracking-wider text-steel hover:text-sage"
            >
              done
            </button>
          )}
          {!editing && (
            <button
              onClick={() => {
                setDraft(item.text);
                setEditing(true);
              }}
              className="text-[10px] uppercase tracking-wider text-steel hover:text-foreground"
            >
              edit
            </button>
          )}
          <button
            onClick={() => deleteItem({ table: item.table, id: item.id })}
            aria-label="Delete"
            className="text-[10px] text-steel hover:text-salmon"
          >
            ✕
          </button>
        </span>
      </div>

      {editing ? (
        <div className="mt-1.5">
          <textarea
            value={draft}
            autoFocus
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            }}
            className="w-full rounded-md border border-lavender/40 bg-black/40 px-2 py-1.5 text-sm text-foreground focus:outline-none"
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => void save()}
              className="rounded-md border border-lavender/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground"
            >
              save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-[10px] uppercase tracking-wider text-steel"
            >
              cancel
            </button>
            <span className="text-[10px] text-steel">⌘⏎ saves · esc cancels</span>
            {error && <span className="text-[10px] text-salmon">{error}</span>}
          </div>
        </div>
      ) : (
        <p className="mt-0.5 text-sm leading-relaxed text-foreground/85 [overflow-wrap:anywhere]">
          {item.text}
        </p>
      )}

      {item.why && !editing && (
        // The rationale is the whole reason a decision is its own store. It is
        // shown, never folded away.
        <p className="mt-1 border-l-2 border-amber/40 pl-2 text-xs leading-relaxed text-foreground/60 [overflow-wrap:anywhere]">
          because {item.why}
        </p>
      )}

      <p className="mt-1 text-[10px] text-steel/70">
        {item.source}
        {item.tags && item.tags.length > 0 && ` · ${item.tags.join(" · ")}`}
      </p>
    </li>
  );
}
