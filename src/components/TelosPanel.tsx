"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SlideOver } from "./SlideOver";

// Telos provenance panel: the item, its cadence state, and the conversation
// that last shaped it (when consolidation or voice edits carried provenance).

function when(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TelosPanel({
  itemId,
  onClose,
}: {
  itemId: Id<"telosItems"> | null;
  onClose: () => void;
}) {
  const detail = useQuery(
    api.telos.itemDetail,
    itemId ? { itemId } : "skip",
  );

  return (
    <SlideOver
      open={itemId !== null}
      onClose={onClose}
      label="Telos"
      accent="bg-cyan-hud"
    >
      {detail === undefined ? (
        <p className="pulse-soft mt-10 text-center text-xs tracking-[0.3em] text-steel">
          SYNCING…
        </p>
      ) : detail === null ? (
        <p className="mt-10 text-center text-sm text-steel">Item not found.</p>
      ) : (
        <>
          <span className="text-[10px] uppercase tracking-[0.3em] text-cyan-hud">
            [{detail.item.kind}] · {detail.item.status} · via {detail.item.source}
          </span>
          <p className="mt-2 font-[family-name:var(--font-display)] text-xl leading-snug text-foreground">
            {detail.item.text}
          </p>
          {detail.item.measurable && (
            <p className="mt-3 text-sm text-foreground/80">
              <span className="text-[10px] uppercase tracking-[0.25em] text-steel">
                Finish line ·{" "}
              </span>
              {detail.item.measurable}
            </p>
          )}
          <p className="mt-3 text-[11px] tracking-wide text-steel">
            reviewed {when(detail.item.reviewedAt)}
            {detail.item.updatedAt && ` · updated ${when(detail.item.updatedAt)}`}
            {` · cadence ${detail.item.reviewCadenceDays}d`}
          </p>

          <h3 className="mt-8 border-b border-panel-edge pb-1 text-[10px] uppercase tracking-[0.3em] text-steel">
            {detail.transcript
              ? `Source: ${detail.transcript.title}`
              : "Source"}
          </h3>
          {detail.transcript ? (
            <div className="mt-3 space-y-2.5">
              {detail.transcript.turns.map((turn, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  <span
                    className={
                      turn.role === "tarik" ? "text-hudblue" : "text-amber"
                    }
                  >
                    {turn.role === "tarik" ? "TARIK" : "ZOLA"}
                  </span>{" "}
                  <span className="text-foreground/80">{turn.text}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-steel">
              Set during the telos interview or import — no single source
              conversation on record.
            </p>
          )}
        </>
      )}
    </SlideOver>
  );
}
