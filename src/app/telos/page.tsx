"use client";

import { useState } from "react";
import { Authenticated, AuthLoading, useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { TelosPanel } from "@/components/TelosPanel";
import { TELOS_KINDS, isStale } from "../../../convex/telosLib";

// Telos page (MOO-490): mission/goals/problems with staleness, provenance
// panel, REVIEW NOW, and a journal rail. Pages are destinations; the panel
// is the transient read.

const KIND_HEADINGS: Record<string, string> = {
  mission: "Mission",
  goal: "Goals",
  problem: "Problems",
  challenge: "Challenges",
  strategy: "Strategies",
  dimension: "Dimensions",
};

const DAY_MS = 24 * 60 * 60 * 1000;

// fresh → aging (past 70% of cadence) → stale (past cadence, via isStale)
function stalenessColor(
  item: { reviewedAt: number; reviewCadenceDays: number },
  now: number,
): string {
  if (isStale(item, now)) return "bg-salmon";
  const aging = now - item.reviewedAt > 0.7 * item.reviewCadenceDays * DAY_MS;
  return aging ? "bg-amber" : "bg-cyan-hud";
}

const STATUS_STYLE: Record<string, string> = {
  active: "border-cyan-hud/50 text-cyan-hud",
  deferred: "border-steel text-steel",
  done: "border-lavender/50 text-lavender",
  dropped: "border-panel-edge text-steel line-through",
};

export default function TelosPage() {
  return (
    <>
      <Authenticated>
        <TelosInner />
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

function TelosInner() {
  const items = useQuery(api.telos.pageItems);
  const journal = useQuery(api.dashboard.recentJournal);
  const runNow = useAction(api.workflowRunner.runNow);
  const [openItem, setOpenItem] = useState<Id<"telosItems"> | null>(null);
  const [reviewQueued, setReviewQueued] = useState(false);
  const now = Date.now();

  async function reviewNow() {
    setReviewQueued(true);
    try {
      await runNow({ name: "weekly-review" });
      setTimeout(() => setReviewQueued(false), 8000);
    } catch {
      setReviewQueued(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3 lg:flex-row">
      <Zone title="Telos" accent="bg-cyan-hud">
        <div className="mb-3 flex items-center gap-3">
          <button
            onClick={reviewNow}
            disabled={reviewQueued}
            className="lcars-cap-left bg-cyan-hud px-4 py-1 font-[family-name:var(--font-display)] text-xs text-black transition hover:opacity-80 disabled:opacity-50"
          >
            {reviewQueued ? "REVIEW BUILDING…" : "REVIEW NOW"}
          </button>
          {reviewQueued && (
            <span className="text-[10px] uppercase tracking-[0.25em] text-steel">
              review brief building on the Briefs page — talk it through with Zola
            </span>
          )}
        </div>

        {items === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : items.length === 0 ? (
          <ZoneEmpty>
            No telos yet — tell Zola “set up my telos” and she'll interview you.
          </ZoneEmpty>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto md:grid-cols-2">
            {TELOS_KINDS.filter((k) => items.some((i) => i.kind === k)).map(
              (kind) => (
                <section key={kind}>
                  <h3 className="border-b border-panel-edge pb-1 text-[10px] uppercase tracking-[0.3em] text-cyan-hud">
                    {KIND_HEADINGS[kind]}
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {items
                      .filter((i) => i.kind === kind)
                      .map((i) => (
                        <li key={i._id}>
                          <button
                            onClick={() => setOpenItem(i._id)}
                            className="flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-panel-edge hover:bg-black/30"
                          >
                            <span
                              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${stalenessColor(i, now)}`}
                              title="review freshness"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="text-sm text-foreground/85 [overflow-wrap:anywhere]">
                                {i.text}
                              </span>
                              {i.measurable && (
                                <span className="mt-0.5 block text-xs text-steel [overflow-wrap:anywhere]">
                                  ▸ {i.measurable}
                                </span>
                              )}
                            </span>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider ${STATUS_STYLE[i.status] ?? "border-panel-edge text-steel"}`}
                            >
                              {i.status}
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}
      </Zone>

      {/* Journal rail */}
      <div className="lg:w-80 lg:shrink-0">
        <Zone title="Journal" accent="bg-lavender">
          {journal === undefined ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : journal.length === 0 ? (
            <ZoneEmpty>No entries yet — “Zola, journal this…”</ZoneEmpty>
          ) : (
            <ul className="space-y-3 overflow-y-auto">
              {journal.map((j) => (
                <li key={j._id} className="text-sm text-foreground/80">
                  {j.text}
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-lavender/60">
                    {j.mode}
                    {j.consolidatedAt !== undefined && " · mined"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Zone>
      </div>

      <TelosPanel itemId={openItem} onClose={() => setOpenItem(null)} />
    </div>
  );
}
