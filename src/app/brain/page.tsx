"use client";

import { useEffect, useRef, useState } from "react";
import { Authenticated, AuthLoading, useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { MemoryPanel } from "@/components/MemoryPanel";

const TYPE_FILTERS = ["all", "preference", "fact", "project", "person"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

// Second Brain page (MOO-483): full memories + thoughts with hybrid
// (vector + text) search.
export default function BrainPage() {
  return (
    <>
      <Authenticated>
        <BrainInner />
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

function BrainInner() {
  const thoughts = useQuery(api.dashboard.recentThoughts);
  const memories = useQuery(api.dashboard.recentMemories);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{
    thoughts: Doc<"thoughts">[];
    memories: Doc<"memories">[];
  } | null>(null);
  const dashboardSearch = useAction(api.memoryOps.dashboardSearch);
  const latestQuery = useRef("");
  useEffect(() => {
    const q = searchQuery.trim();
    latestQuery.current = q;
    if (!q) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      dashboardSearch({ searchQuery: q })
        .then((res) => {
          if (latestQuery.current === q) setSearchResults(res);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, dashboardSearch]);

  const searching = searchQuery.trim() !== "";
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [openMemory, setOpenMemory] = useState<Id<"memories"> | null>(null);
  const shownThoughts = searching ? searchResults?.thoughts : thoughts;
  const baseMemories = searching ? searchResults?.memories : memories;
  const shownMemories =
    typeFilter === "all"
      ? baseMemories
      : baseMemories?.filter((m) => m.type === typeFilter);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <Zone title="Second Brain" accent="bg-lavender">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search thoughts and memories (semantic)…"
          className="mb-3 w-full rounded-md border border-panel-edge bg-black/40 px-3 py-1.5 text-sm text-foreground placeholder:text-steel focus:border-lavender focus:outline-none"
        />
        <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto md:grid-cols-2">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="mr-2 text-[10px] uppercase tracking-[0.3em] text-lavender">
                Memories
              </h3>
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition ${
                    typeFilter === t
                      ? "border-lavender/70 bg-lavender/15 text-foreground"
                      : "border-panel-edge text-steel hover:border-lavender/40"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {shownMemories === undefined ? (
              <ZoneEmpty>syncing…</ZoneEmpty>
            ) : shownMemories.length === 0 ? (
              <ZoneEmpty>
                {searching || typeFilter !== "all"
                  ? "No matches."
                  : "Zola hasn't learned anything yet."}
              </ZoneEmpty>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {shownMemories.map((m) => (
                  <li key={m._id}>
                    <button
                      onClick={() => setOpenMemory(m._id)}
                      className="w-full rounded-md border border-transparent px-2 py-1 text-left text-sm text-foreground/80 transition hover:border-panel-edge hover:bg-black/30"
                    >
                      <span className="text-lavender/70">[{m.type}]</span>{" "}
                      {m.content}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-[10px] uppercase tracking-[0.3em] text-lavender">
              Thoughts
            </h3>
            {shownThoughts === undefined ? (
              <ZoneEmpty>syncing…</ZoneEmpty>
            ) : shownThoughts.length === 0 ? (
              <ZoneEmpty>
                {searching ? "No matches." : "Nothing captured yet."}
              </ZoneEmpty>
            ) : (
              <ul className="mt-2 space-y-2">
                {shownThoughts.map((t) => (
                  <li key={t._id} className="text-sm text-foreground/80">
                    {t.cleaned}
                    {t.tags.length > 0 && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-lavender/60">
                        {t.tags.join(" · ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Zone>

      <MemoryPanel memoryId={openMemory} onClose={() => setOpenMemory(null)} />
    </div>
  );
}
