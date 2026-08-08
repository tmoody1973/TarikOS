"use client";

import { useState } from "react";
import { Authenticated, AuthLoading, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { VoteRow } from "@/components/habits/VoteRow";
import { TrajectoryStrip } from "@/components/habits/TrajectoryStrip";
import { FieldNote } from "@/components/habits/FieldNote";

// Habits page (MOO-505): three-panel bridge console — pillars, today's
// graded votes, and a trajectory strip that shows returns-after-gap
// instead of a streak. Suggestions render as a question, never pre-ticked.
export default function HabitsPage() {
  return (
    <>
      <Authenticated>
        <HabitsInner />
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

function HabitsInner() {
  const habits = useQuery(api.habits.today, {});
  const [selected, setSelected] = useState<string | null>(null);
  const habitId = selected ?? habits?.[0]?.id ?? null;
  const traj = useQuery(
    api.habits.trajectory,
    habitId ? { habitId: habitId as Id<"habits">, days: 30 } : "skip",
  );
  const friction = useQuery(
    api.habits.weekFriction,
    habitId ? { habitId: habitId as Id<"habits"> } : "skip",
  );

  return (
    <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
      <Zone title="Pillars" accent="bg-sage">
        {habits === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : habits.length === 0 ? (
          <ZoneEmpty>No active pillars. Ask Zola to set one up.</ZoneEmpty>
        ) : (
          <ul className="flex flex-col gap-2">
            {habits.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => setSelected(h.id)}
                  className={`w-full rounded-md border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-cyan-hud ${
                    h.id === habitId
                      ? "border-sage"
                      : "border-panel-edge hover:border-steel"
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-[0.3em] text-steel">
                    {h.pillar}
                  </span>
                  <span className="mt-1 block font-[family-name:var(--font-mono-hud)] text-xs text-foreground/85">
                    {h.identity}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {friction && friction.length > 0 && (
          <div className="mt-4 border-t border-panel-edge pt-3">
            <h3 className="mb-2 text-[10px] uppercase tracking-[0.3em] text-steel">
              Friction log
            </h3>
            <ul className="flex flex-col gap-1.5 font-[family-name:var(--font-mono-hud)] text-xs leading-6 text-foreground/70">
              {friction.map((f, i) => (
                <li key={i}>— {f}</li>
              ))}
            </ul>
          </div>
        )}
      </Zone>

      <Zone title="Today's votes" accent="bg-sage">
        {habits === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : habits.length === 0 ? (
          <ZoneEmpty>Nothing to vote on yet.</ZoneEmpty>
        ) : (
          <ul className="flex flex-col gap-3">
            {habits.map((h) => (
              <VoteRow key={h.id} habit={h} />
            ))}
          </ul>
        )}
      </Zone>

      <Zone title="Trajectory" accent="bg-sage">
        {habits?.length === 0 ? (
          <ZoneEmpty>No active pillars yet.</ZoneEmpty>
        ) : traj === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : (
          <div className="flex flex-col gap-4">
            <TrajectoryStrip series={traj.series} summary={traj.summary} />
            <FieldNote returns={traj.summary.returns} logged={traj.summary.logged} />
          </div>
        )}
      </Zone>
    </div>
  );
}
