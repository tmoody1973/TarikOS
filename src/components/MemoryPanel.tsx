"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SlideOver } from "./SlideOver";

// Memory provenance panel: what Zola believes, when she learned it, and the
// conversation that taught it — with a delete for anything wrong.

function when(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MemoryPanel({
  memoryId,
  onClose,
}: {
  memoryId: Id<"memories"> | null;
  onClose: () => void;
}) {
  const detail = useQuery(
    api.dashboard.memoryDetail,
    memoryId ? { memoryId } : "skip",
  );
  const deleteMemory = useMutation(api.dashboard.deleteMemory);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [memoryId]);

  async function handleDelete() {
    if (!memoryId) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await deleteMemory({ memoryId });
    onClose();
  }

  return (
    <SlideOver
      open={memoryId !== null}
      onClose={onClose}
      label="Memory"
      accent="bg-hudblue"
      footer={
        <button
          onClick={handleDelete}
          className={`lcars-cap-right px-4 py-1.5 font-[family-name:var(--font-display)] text-sm text-black transition hover:opacity-80 ${
            confirming ? "bg-salmon" : "bg-steel"
          }`}
        >
          {confirming ? "SURE? DELETE" : "FORGET THIS"}
        </button>
      }
    >
      {detail === undefined ? (
        <p className="pulse-soft mt-10 text-center text-xs tracking-[0.3em] text-steel">
          SYNCING…
        </p>
      ) : detail === null ? (
        <p className="mt-10 text-center text-sm text-steel">Memory not found.</p>
      ) : (
        <>
          <span className="text-[10px] uppercase tracking-[0.3em] text-hudblue">
            [{detail.memory.type}] · learned {when(detail.memory._creationTime)}
            {detail.memory.updatedAt &&
              ` · updated ${when(detail.memory.updatedAt)}`}
          </span>
          <p className="mt-2 font-[family-name:var(--font-display)] text-xl leading-snug text-foreground">
            {detail.memory.content}
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
              Told to Zola directly ("remember this") or predates provenance
              tracking — no source conversation on record.
            </p>
          )}
        </>
      )}
    </SlideOver>
  );
}
