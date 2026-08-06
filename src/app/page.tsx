"use client";

import { useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { api } from "../../convex/_generated/api";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { StatusRail } from "@/components/hud/StatusRail";

const KIND_COLOR: Record<string, string> = {
  calendar: "text-hudblue",
  email: "text-salmon",
  research: "text-lavender",
  note: "text-amber",
};

export default function Dashboard() {
  const cards = useQuery(api.dashboard.briefingCards);
  const thoughts = useQuery(api.dashboard.recentThoughts);
  const memories = useQuery(api.dashboard.recentMemories);
  const transcripts = useQuery(api.dashboard.recentTranscripts);
  const tools = useQuery(api.dashboard.toolRegistry);

  return (
    <div className="flex flex-1 gap-3 p-3">
      <StatusRail />

      <main className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-2 lg:grid-rows-2">
        {/* Conversation surface */}
        <Zone title="Conversation" accent="bg-amber">
          <div className="flex items-center gap-3 border-b border-panel-edge pb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-steel pulse-soft" />
            <span className="text-xs tracking-[0.25em] text-steel">
              VOICE LINK OFFLINE · MILESTONE 2
            </span>
          </div>
          <div className="mt-3 flex-1 overflow-y-auto">
            {transcripts === undefined ? (
              <ZoneEmpty>syncing…</ZoneEmpty>
            ) : transcripts.length === 0 ? (
              <ZoneEmpty>
                No conversations yet. Morpheus is waiting to hear your voice.
              </ZoneEmpty>
            ) : (
              <ul className="space-y-2">
                {transcripts.map((t) => (
                  <li key={t._id} className="text-sm text-foreground/80">
                    <span className="text-amber">{t.title}</span> ·{" "}
                    {t.turns.length} turns
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Zone>

        {/* Command center */}
        <Zone title="Command Center" accent="bg-hudblue">
          {cards === undefined ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : cards.length === 0 ? (
            <ZoneEmpty>No briefing cards yet.</ZoneEmpty>
          ) : (
            <ul className="space-y-3 overflow-y-auto">
              {cards.map((c) => (
                <li
                  key={c._id}
                  className="rounded-md border border-panel-edge bg-black/30 p-3"
                >
                  <div
                    className={`text-[10px] uppercase tracking-[0.3em] ${KIND_COLOR[c.kind]} hud-glow`}
                  >
                    {c.kind}
                  </div>
                  <div className="mt-1 font-[family-name:var(--font-display)] text-lg text-foreground">
                    {c.title}
                  </div>
                  <p className="mt-1 text-sm text-foreground/70">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Zone>

        {/* Second brain */}
        <Zone title="Second Brain" accent="bg-lavender">
          <div className="grid flex-1 grid-cols-2 gap-4 overflow-y-auto">
            <div>
              <h3 className="text-[10px] uppercase tracking-[0.3em] text-lavender">
                Thoughts
              </h3>
              {thoughts === undefined ? (
                <ZoneEmpty>syncing…</ZoneEmpty>
              ) : thoughts.length === 0 ? (
                <ZoneEmpty>Nothing captured yet.</ZoneEmpty>
              ) : (
                <ul className="mt-2 space-y-2">
                  {thoughts.map((t) => (
                    <li key={t._id} className="text-sm text-foreground/80">
                      {t.cleaned}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-[10px] uppercase tracking-[0.3em] text-lavender">
                Memories
              </h3>
              {memories === undefined ? (
                <ZoneEmpty>syncing…</ZoneEmpty>
              ) : memories.length === 0 ? (
                <ZoneEmpty>Morpheus hasn&apos;t learned anything yet.</ZoneEmpty>
              ) : (
                <ul className="mt-2 space-y-2">
                  {memories.map((m) => (
                    <li key={m._id} className="text-sm text-foreground/80">
                      <span className="text-lavender/70">[{m.type}]</span>{" "}
                      {m.content}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Zone>

        {/* Control panel */}
        <Zone title="Control Panel" accent="bg-salmon">
          {tools === undefined ? (
            <ZoneEmpty>syncing…</ZoneEmpty>
          ) : (
            <ul className="space-y-1.5 overflow-y-auto">
              {tools.map((tool) => (
                <li
                  key={tool._id}
                  className="flex items-center gap-3 rounded-md border border-panel-edge bg-black/30 px-3 py-2"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      tool.health === "ok"
                        ? "bg-cyan-hud"
                        : tool.health === "error"
                          ? "bg-salmon"
                          : "bg-steel"
                    }`}
                  />
                  <span className="text-sm text-foreground/90">{tool.name}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-[0.2em] text-steel">
                    {tool.enabled ? "enabled" : "standby"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Zone>
      </main>

      <div className="absolute right-5 top-5">
        <UserButton />
      </div>
    </div>
  );
}
