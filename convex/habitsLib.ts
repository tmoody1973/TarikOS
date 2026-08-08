// Pure habit helpers — no Convex imports — usable from Convex functions,
// the tool routes, and tests (same pattern as telosLib and workflowLib).

export const VOTE_LEVELS = [
  "minimum",
  "standard",
  "beyond",
  "skipped",
  "missed",
] as const;

export const EVIDENCE_MODES = ["self_report", "calendar_suggest"] as const;

export const HABIT_STATUSES = ["active", "paused", "retired"] as const;

export type VoteLevel = (typeof VOTE_LEVELS)[number];
export type EvidenceMode = (typeof EVIDENCE_MODES)[number];
export type HabitStatus = (typeof HABIT_STATUSES)[number];

const DAY = 24 * 60 * 60 * 1000;

/* The one place that decides whether inferred evidence may touch a habit.
 * self_report is the default, so relationship, health and reflection pillars
 * are uninferable unless deliberately opened up. */
export function canSuggest(habit: {
  evidenceMode: EvidenceMode;
  status: HabitStatus;
}): boolean {
  return habit.evidenceMode === "calendar_suggest" && habit.status === "active";
}

export function cycleEndsAt(startsAt: number, weeks = 6): number {
  return startsAt + weeks * 7 * DAY;
}

export function isCycleActive(
  cycle: { startsAt: number; endsAt: number },
  now: number,
): boolean {
  return now >= cycle.startsAt && now <= cycle.endsAt;
}

export type DayVote = { date: string; level: VoteLevel | null };

export type Trajectory = {
  logged: number;
  byLevel: Record<VoteLevel, number>;
  longestGap: number;
  returns: number;
};

/* A gap is consecutive days with no vote or an explicit "missed". An
 * intentional skip is a decision, not a gap — the spec is explicit that it
 * carries no penalty. `returns` counts how often practice resumed after a
 * gap, which is the number this module actually displays. */
export function summarizeTrajectory(days: DayVote[]): Trajectory {
  const byLevel = Object.fromEntries(
    VOTE_LEVELS.map((l) => [l, 0]),
  ) as Record<VoteLevel, number>;

  let logged = 0;
  let longestGap = 0;
  let returns = 0;
  let currentGap = 0;

  for (const day of days) {
    if (day.level) {
      logged += 1;
      byLevel[day.level] += 1;
    }
    const isGapDay = day.level === null || day.level === "missed";
    if (isGapDay) {
      currentGap += 1;
      if (currentGap > longestGap) longestGap = currentGap;
      continue;
    }
    if (day.level === "skipped") continue; // neither extends nor closes a gap
    if (currentGap > 0) returns += 1;
    currentGap = 0;
  }

  return { logged, byLevel, longestGap, returns };
}

export type HabitWeek = {
  pillar: string;
  days: DayVote[];
  friction: string[];
};

/* The weekly review section. It reports trajectory and friction, most
 * frictional pillar first, then asks for exactly one change on that pillar —
 * changing several at once makes it impossible to tell which one helped. */
export function buildHabitReview(weeks: HabitWeek[]): string {
  if (weeks.length === 0) {
    return "No active habits this week. Set a pillar up when you're ready.";
  }

  // Rank by friction count, descending. Ties keep input order via an
  // explicit index key — not a reliance on sort() being stable.
  const ranked = weeks
    .map((week, index) => ({ week, index }))
    .sort((a, b) => b.week.friction.length - a.week.friction.length || a.index - b.index)
    .map(({ week }) => week);

  const lines: string[] = [];
  for (const week of ranked) {
    const t = summarizeTrajectory(week.days);
    const parts = [`${t.logged} logged`];
    if (t.returns > 0) parts.push(`came back ${t.returns}×`);
    if (t.longestGap > 0) parts.push(`longest gap ${t.longestGap}d`);
    lines.push(`- **${week.pillar}** — ${parts.join(" · ")}`);
    if (week.friction.length > 0) {
      lines.push(`  - friction: ${week.friction.join("; ")}`);
    }
  }

  lines.push("");
  const leader = ranked[0];
  lines.push(
    leader.friction.length > 0
      ? `Adjust one variable for **${leader.pillar}**: the cue, the size, the location, the backup plan, or pause it.`
      : "Adjust one variable only: the cue, the size, the location, the backup plan, or pause it.",
  );
  return lines.join("\n");
}
