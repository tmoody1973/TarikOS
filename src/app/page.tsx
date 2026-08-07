"use client";

import Link from "next/link";
import { Authenticated, AuthLoading, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import { api } from "../../convex/_generated/api";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";

// Home (MOO-483): command center + summary cards. Zones summarize; pages
// hold the detail; the voice dock (AppShell) is the conversation surface.
export default function Home() {
  return (
    <>
      <Authenticated>
        <HomeInner />
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

const KIND_COLOR: Record<string, string> = {
  calendar: "text-hudblue",
  email: "text-salmon",
  research: "text-lavender",
  note: "text-amber",
};

const STATUS_COLOR: Record<string, string> = {
  ready: "bg-cyan-hud",
  building: "bg-amber pulse-soft",
  error: "bg-salmon",
};

function HomeInner() {
  const cards = useQuery(api.dashboard.briefingCards);
  const summary = useQuery(api.dashboard.homeSummary);

  return (
    <div className="relative grid flex-1 grid-cols-1 gap-3 lg:grid-cols-2 lg:grid-rows-2">
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

      {/* Latest brief */}
      <Zone title="Briefs" accent="bg-lavender">
        {summary === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : summary.brief === null ? (
          <ZoneEmpty>No briefs yet — the morning brief builds weekdays at 7am.</ZoneEmpty>
        ) : (
          <Link
            href="/briefs"
            className="group flex flex-1 flex-col justify-center gap-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${STATUS_COLOR[summary.brief.status] ?? "bg-steel"}`}
              />
              <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
                latest · {summary.brief.status} · {summary.brief.sectionCount}{" "}
                sections
              </span>
            </div>
            <div className="font-[family-name:var(--font-display)] text-2xl text-foreground transition group-hover:text-lavender">
              {summary.brief.title}
            </div>
            <span className="text-xs tracking-[0.2em] text-lavender/70">
              OPEN BRIEFS →
            </span>
          </Link>
        )}
      </Zone>

      {/* Second brain summary */}
      <Zone title="Second Brain" accent="bg-hudblue">
        {summary === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : (
          <Link href="/brain" className="group flex flex-1 flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
              {summary.brain.memoryCount} memories ·{" "}
              {summary.brain.thoughtCount} thoughts
            </span>
            <ul className="space-y-1.5">
              {summary.brain.latestMemories.map((m, i) => (
                <li key={i} className="text-sm text-foreground/80">
                  <span className="text-hudblue/70">[{m.type}]</span>{" "}
                  {m.content}
                </li>
              ))}
            </ul>
            <span className="mt-auto text-xs tracking-[0.2em] text-hudblue/70 transition group-hover:text-hudblue">
              OPEN SECOND BRAIN →
            </span>
          </Link>
        )}
      </Zone>

      {/* Control summary */}
      <Zone title="Control Panel" accent="bg-salmon">
        {summary === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : (
          <Link href="/control" className="group flex flex-1 flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
              systems
            </span>
            <div className="font-[family-name:var(--font-display)] text-2xl text-foreground">
              {summary.control.toolCount} tools ·{" "}
              {summary.control.workflowCount} workflows
            </div>
            <p className="text-sm">
              {summary.control.errorCount > 0 ? (
                <span className="text-salmon">
                  {summary.control.errorCount} tool error(s) need attention
                </span>
              ) : (
                <span className="text-cyan-hud">all systems healthy</span>
              )}
              {summary.control.disabledCount > 0 && (
                <span className="text-steel">
                  {" "}
                  · {summary.control.disabledCount} disabled
                </span>
              )}
            </p>
            <span className="mt-auto text-xs tracking-[0.2em] text-salmon/70 transition group-hover:text-salmon">
              OPEN CONTROL PANEL →
            </span>
          </Link>
        )}
      </Zone>

      <div className="absolute right-2 top-2">
        <UserButton />
      </div>
    </div>
  );
}
