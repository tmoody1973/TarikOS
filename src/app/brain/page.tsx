"use client";

import { useEffect, useRef, useState } from "react";
import { Authenticated, AuthLoading, useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";

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
  const shownThoughts = searching ? searchResults?.thoughts : thoughts;
  const shownMemories = searching ? searchResults?.memories : memories;

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
            <h3 className="text-[10px] uppercase tracking-[0.3em] text-lavender">
              Memories
            </h3>
            {shownMemories === undefined ? (
              <ZoneEmpty>syncing…</ZoneEmpty>
            ) : shownMemories.length === 0 ? (
              <ZoneEmpty>
                {searching ? "No matches." : "Zola hasn't learned anything yet."}
              </ZoneEmpty>
            ) : (
              <ul className="mt-2 space-y-2">
                {shownMemories.map((m) => (
                  <li key={m._id} className="text-sm text-foreground/80">
                    <span className="text-lavender/70">[{m.type}]</span>{" "}
                    {m.content}
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
    </div>
  );
}
