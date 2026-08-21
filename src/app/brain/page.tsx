"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Authenticated, AuthLoading } from "convex/react";
import { Zone } from "@/components/hud/Zone";
import { BrainStream } from "@/components/BrainStream";
import { BrainGraph } from "@/components/BrainGraph";
import { BrainFocus } from "@/components/BrainFocus";

/**
 * The second brain, as a screen.
 *
 * It is deliberately NOT an archive to browse. Voice is the front door and the
 * morning brief is the daily orientation, which leaves this page one job:
 * checking her work. What has she learned, where did she get it, and is any of
 * it wrong. That is the stream.
 *
 * The graph is the second way of looking at the same store — the shape rather
 * than the sequence. Its node inspector is the detail view; there is no third
 * screen and there is nothing here that asks him to tidy anything.
 */
export default function BrainPage() {
  return (
    <>
      <Authenticated>
        <Suspense fallback={null}>
          <BrainInner />
        </Suspense>
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

const VIEWS = ["focus", "stream", "graph"] as const;
type View = (typeof VIEWS)[number];

function BrainInner() {
  // navigate_ui: /brain?view=graph[&focus=<label fragment>]
  const params = useSearchParams();
  const requested = params.get("view");
  const [view, setView] = useState<View>(
    (VIEWS as readonly string[]).includes(requested ?? "") ? (requested as View) : "focus",
  );
  const [search, setSearch] = useState("");
  const focusHint = params.get("focus") ?? undefined;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <Zone title="Second Brain" accent="bg-lavender">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wider transition ${
                  view === v
                    ? "border-lavender/70 bg-lavender/15 text-foreground"
                    : "border-panel-edge text-steel hover:border-lavender/40"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {view === "stream" && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search her memory…"
              className="min-w-0 flex-1 rounded-md border border-panel-edge bg-black/40 px-3 py-1.5 text-sm text-foreground placeholder:text-steel focus:border-lavender focus:outline-none"
            />
          )}
        </div>

        {view === "graph" ? (
          <BrainGraph focusHint={focusHint} />
        ) : view === "focus" ? (
          <BrainFocus />
        ) : (
          <BrainStream search={search} />
        )}
      </Zone>
    </div>
  );
}
