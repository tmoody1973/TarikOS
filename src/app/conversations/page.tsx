"use client";

import { useState } from "react";
import { Authenticated, AuthLoading, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";

// Conversations page (MOO-483): transcript list + full reader.
export default function ConversationsPage() {
  return (
    <>
      <Authenticated>
        <ConversationsInner />
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

function ConversationsInner() {
  const transcripts = useQuery(api.dashboard.recentTranscripts);
  const [selectedId, setSelectedId] = useState<Id<"transcripts"> | null>(null);
  const activeId = selectedId ?? transcripts?.[0]?._id ?? null;
  const transcript = useQuery(
    api.transcripts.get,
    activeId ? { transcriptId: activeId } : "skip",
  );

  return (
    <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_2.5fr]">
      <Zone title="Conversations" accent="bg-salmon">
        {transcripts === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : transcripts.length === 0 ? (
          <ZoneEmpty>No conversations logged yet.</ZoneEmpty>
        ) : (
          <ul className="space-y-1.5 overflow-y-auto">
            {transcripts.map((t) => (
              <li key={t._id}>
                <button
                  onClick={() => setSelectedId(t._id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    t._id === activeId
                      ? "border-salmon/60 bg-salmon/10"
                      : "border-panel-edge bg-black/30 hover:border-salmon/30"
                  }`}
                >
                  <span className="block truncate text-sm text-foreground/90">
                    {t.title}
                  </span>
                  <span className="block text-[10px] uppercase tracking-wider text-steel">
                    {t.turns.length} turns
                    {t.toolCalls.length > 0 &&
                      ` · ${t.toolCalls.length} tool call(s)`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Zone>

      <Zone title={transcript?.title ?? "Reader"} accent="bg-amber">
        {transcript === undefined && activeId ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : !transcript ? (
          <ZoneEmpty>Select a conversation.</ZoneEmpty>
        ) : transcript.turns.length === 0 ? (
          <ZoneEmpty>Empty conversation.</ZoneEmpty>
        ) : (
          <div className="flex-1 space-y-2.5 overflow-y-auto pr-2">
            {transcript.turns.map((turn, i) => (
              <p key={i} className="text-sm leading-relaxed">
                <span
                  className={
                    turn.role === "tarik" ? "text-hudblue" : "text-amber"
                  }
                >
                  {turn.role === "tarik" ? "TARIK" : "ZOLA"}
                </span>{" "}
                <span className="text-foreground/85">{turn.text}</span>
              </p>
            ))}
          </div>
        )}
      </Zone>
    </div>
  );
}
