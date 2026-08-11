"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

// Rewrites waiting to be taken or left.
//
// One panel for both origins. A proposal Zola made by voice and one made from
// the screen are the same object, so this is the only place either is reviewed
// — two review surfaces would be two things that must always agree, and the
// same disagreement two brief stores would have caused.
//
// It appears while she is still talking, because the query is live.
//
// The diff is the whole point of it being on screen rather than in the call:
// before and after, side by side, and nothing happens until he says so.

export function ProposalsPanel({ id }: { id: Id<"studioDocs"> }) {
  const proposals = useQuery(api.studio.proposals, { id });
  const accept = useMutation(api.studio.acceptProposal);
  const reject = useMutation(api.studio.rejectProposal);
  const [problem, setProblem] = useState<string | null>(null);

  if (!proposals || proposals.length === 0) return null;

  return (
    <section
      aria-label="Suggested edits"
      className="shrink-0 rounded-lg border border-ochre/40 bg-panel"
    >
      <h2 className="border-b border-panel-edge px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-ochre">
        Suggested · {proposals.length}
      </h2>
      {problem ? (
        <p className="border-b border-panel-edge px-3 py-2 text-xs text-salmon">{problem}</p>
      ) : null}
      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto p-2">
        {proposals.map((p) => (
          <li key={p._id} className="rounded-md border border-panel-edge bg-black/20 p-2.5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-steel">
              {p.origin === "voice" ? "Zola, by voice" : "Zola"} · {p.instruction}
            </p>
            <p className="mt-1.5 text-xs text-steel line-through decoration-salmon/60">
              {p.original}
            </p>
            <p className="mt-1 text-xs text-foreground">{p.proposed}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={async () => {
                  // Cleared first: a refusal from a previous card stayed on
                  // screen while a later action succeeded, so the panel read as
                  // broken when it had just done what it was asked.
                  setProblem(null);
                  const res = await accept({ id: p._id });
                  if (!res.ok) {
                    setProblem(
                      res.reason === "moved"
                        ? "That passage has changed since the suggestion was made, so it wasn't applied. Leave it, and ask again."
                        : "That suggestion is no longer there.",
                    );
                    return;
                  }
                  // The editor holds the old text in memory — the same reason
                  // restoring a version reloads. Applying without this leaves
                  // the accepted text invisible until the next refresh, and the
                  // editor's next autosave would be refused as stale.
                  window.location.reload();
                }}
                className="rounded-md border border-ochre px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-ochre transition-colors hover:bg-ochre hover:text-black focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
              >
                Take it
              </button>
              <button
                onClick={() => {
                  setProblem(null);
                  void reject({ id: p._id });
                }}
                className="rounded-md border border-panel-edge px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
              >
                Leave it
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
