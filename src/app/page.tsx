"use client";

import { useState } from "react";
import { Authenticated, AuthLoading, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { ConversationProvider } from "@elevenlabs/react";
import { api } from "../../convex/_generated/api";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { StatusRail } from "@/components/hud/StatusRail";
import { VoiceLink } from "@/components/hud/VoiceLink";

export default function Dashboard() {
  return (
    <>
      <Authenticated>
        <DashboardInner />
      </Authenticated>
      <AuthLoading>
        <div className="flex flex-1 items-center justify-center">
          <p className="pulse-soft font-[family-name:var(--font-mono-hud)] text-xs tracking-[0.3em] text-steel">
            MORPHEUS · AUTHENTICATING…
          </p>
        </div>
      </AuthLoading>
    </>
  );
}

const KIND_COLOR: Record<string, string> = {
  calendar: "text-hudblue",
  email: "text-salmon",
  research: "text-lavender",
  note: "text-amber",
};

function DashboardInner() {
  const cards = useQuery(api.dashboard.briefingCards);
  const thoughts = useQuery(api.dashboard.recentThoughts);
  const memories = useQuery(api.dashboard.recentMemories);
  const transcripts = useQuery(api.dashboard.recentTranscripts);
  const tools = useQuery(api.dashboard.toolRegistry);

  const [searchQuery, setSearchQuery] = useState("");
  const searchResults = useQuery(
    api.transcripts.searchSecondBrain,
    searchQuery.trim() ? { searchQuery } : "skip",
  );
  const searching = searchQuery.trim() !== "";
  const shownThoughts = searching ? searchResults?.thoughts : thoughts;
  const shownMemories = searching ? searchResults?.memories : memories;

  return (
    <div className="flex flex-1 gap-3 p-3">
      <StatusRail />

      <main className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-2 lg:grid-rows-2">
        {/* Conversation surface */}
        <Zone title="Conversation" accent="bg-amber">
          <ConversationProvider>
            <VoiceLink />
          </ConversationProvider>
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
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search thoughts and memories…"
            className="mb-3 w-full rounded-md border border-panel-edge bg-black/40 px-3 py-1.5 text-sm text-foreground placeholder:text-steel focus:border-lavender focus:outline-none"
          />
          <div className="grid flex-1 grid-cols-2 gap-4 overflow-y-auto">
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
            <div>
              <h3 className="text-[10px] uppercase tracking-[0.3em] text-lavender">
                Memories
              </h3>
              {shownMemories === undefined ? (
                <ZoneEmpty>syncing…</ZoneEmpty>
              ) : shownMemories.length === 0 ? (
                <ZoneEmpty>
                  {searching ? "No matches." : "Morpheus hasn't learned anything yet."}
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
          </div>
          <div className="mt-3 border-t border-panel-edge pt-2">
            <h3 className="text-[10px] uppercase tracking-[0.3em] text-lavender">
              Conversations
            </h3>
            {transcripts === undefined || transcripts.length === 0 ? (
              <ZoneEmpty>No conversations logged yet.</ZoneEmpty>
            ) : (
              <ul className="mt-1 space-y-1">
                {transcripts.slice(0, 4).map((t) => (
                  <li key={t._id} className="text-xs text-foreground/70">
                    <span className="text-amber/80">{t.title}</span> ·{" "}
                    {t.turns.length} turns
                    {t.toolCalls.length > 0 &&
                      ` · ${t.toolCalls.length} tool call(s)`}
                  </li>
                ))}
              </ul>
            )}
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
