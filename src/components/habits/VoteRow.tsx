"use client";

import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// Completion is graded, not binary: "minimum" and "standard" are different
// truths and a checkbox cannot tell them apart.
const LEVELS = [
  { key: "minimum", label: "MIN" },
  { key: "standard", label: "STD" },
  { key: "beyond", label: "BEYOND" },
  { key: "skipped", label: "SKIP" },
] as const;

const LEVEL_NAMES: Record<(typeof LEVELS)[number]["key"], string> = {
  minimum: "Minimum",
  standard: "Standard",
  beyond: "Beyond",
  skipped: "Skipped",
};

export function VoteRow({
  habit,
}: {
  habit: {
    id: string;
    pillar: string;
    identity: string;
    minimumAction: string;
    cue: string;
    level: string | null;
    suggestion: { id: string; reason: string } | null;
  };
}) {
  const logVote = useMutation(api.habits.logVote);
  const resolve = useMutation(api.habits.resolveSuggestion);

  return (
    <li className="rounded-lg border border-panel-edge bg-panel p-4">
      <div className="text-[10px] uppercase tracking-[0.3em] text-sage">
        {habit.pillar}
      </div>
      <p className="mt-1 font-[family-name:var(--font-mono-hud)] text-sm text-foreground/85">
        {habit.identity}
      </p>
      <p className="mt-1 font-[family-name:var(--font-mono-hud)] text-xs text-steel">
        {habit.cue} · min: {habit.minimumAction}
      </p>

      {habit.suggestion && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-panel-edge px-3 py-2">
          <span className="font-[family-name:var(--font-mono-hud)] text-xs text-foreground/85">
            {habit.suggestion.reason}
          </span>
          <button
            onClick={() =>
              resolve({
                suggestionId: habit.suggestion!.id as Id<"habitSuggestions">,
                accept: true,
                level: "standard",
              })
            }
            className="rounded-md border border-sage/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-sage transition hover:bg-sage/10 focus-visible:outline-2 focus-visible:outline-cyan-hud"
          >
            Count it
          </button>
          <button
            onClick={() =>
              resolve({
                suggestionId: habit.suggestion!.id as Id<"habitSuggestions">,
                accept: false,
              })
            }
            className="rounded-md border border-panel-edge px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-steel transition hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud"
          >
            No
          </button>
        </div>
      )}

      <div
        role="group"
        aria-label="Log today's level"
        className="mt-3 flex flex-wrap gap-2"
      >
        {LEVELS.map((l) => (
          <button
            key={l.key}
            aria-label={LEVEL_NAMES[l.key]}
            onClick={() =>
              logVote({
                habitId: habit.id as Id<"habits">,
                level: l.key,
                source: "ui",
              })
            }
            className={`rounded-full border px-3 py-0.5 text-[10px] uppercase tracking-wider transition focus-visible:outline-2 focus-visible:outline-cyan-hud ${
              habit.level === l.key
                ? "border-sage text-sage"
                : "border-panel-edge text-steel hover:text-foreground"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </li>
  );
}
