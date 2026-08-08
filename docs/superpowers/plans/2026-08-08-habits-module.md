# Habits Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an identity-based habits module for Tarik OS where a daily "vote" is logged by voice or on a page, calendar evidence can only ever suggest, and the metric on display is returning after a gap rather than an unbroken streak.

**Architecture:** Five new Convex tables with a pure helper module (`convex/habitsLib.ts`) holding all date and trajectory logic. Five webhook tools follow the existing `/api/tools/[tool]` pattern so they self-register in `/control`. A three-panel `/habits` page reads through Convex live queries. Two crons compose the evening check-in and the weekly review section. The load-bearing rule — calendar evidence writes a `habitSuggestion`, never a `habitVote` — is enforced at the mutation and guarded by a source-scan tripwire.

**Tech Stack:** Convex (schema, queries, mutations, crons), Next.js 16 App Router, React 19, Tailwind CSS 4, `node --test` for tests, ElevenLabs agent provisioning via `scripts/provision-agent.ts`.

**Spec:** `docs/superpowers/specs/2026-08-08-tarik-os-habits-design.md`
**Linear:** MOO-505

## Global Constraints

- Cross-module imports inside `convex/` and from `tests/` **must** carry the `.ts` extension (e.g. `import { chicagoToday } from "./workflowLib.ts"`). Node's ESM loader fails without it.
- Pure helper modules (`convex/*Lib.ts`) **must not** import from `convex/_generated` or `convex/server` — they are imported by tests directly.
- Dates are Chicago civil dates in `YYYY-MM-DD` form, produced by `chicagoToday()` from `convex/workflowLib.ts`. Never use `new Date().toISOString().slice(0,10)`.
- Every new webhook tool must be added to **both** `src/app/api/tools/[tool]/route.ts` and the `TOOLS` array in `scripts/provision-agent.ts`.
- Tests run with `npm test` (`node --test "tests/*.test.ts"`). A single file: `node --test tests/<name>.test.ts`.
- No streak counter may be introduced anywhere in the codebase.
- `evidenceMode` defaults to `"self_report"` in the schema, in the mutation, and in the tool.
- New Tailwind colour tokens are declared in `src/app/globals.css` in both `:root` and the `@theme inline` block, matching the existing pattern.

---

### Task 1: Pure habit helpers

**Files:**
- Create: `convex/habitsLib.ts`
- Test: `tests/habitsLib.test.ts`

**Interfaces:**
- Consumes: `chicagoToday` from `convex/workflowLib.ts`
- Produces: `VOTE_LEVELS`, `EVIDENCE_MODES`, `HABIT_STATUSES`, types `VoteLevel` / `EvidenceMode` / `HabitStatus`, `canSuggest(habit)`, `cycleEndsAt(startsAt, weeks?)`, `isCycleActive(cycle, now)`, `summarizeTrajectory(days)` returning `{ logged, byLevel, longestGap, returns }`

- [ ] **Step 1: Write the failing test**

Create `tests/habitsLib.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSuggest,
  cycleEndsAt,
  isCycleActive,
  summarizeTrajectory,
  VOTE_LEVELS,
} from "../convex/habitsLib.ts";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-08-01T05:00:00Z");

test("only a calendar_suggest habit may receive a suggestion", () => {
  assert.equal(
    canSuggest({ evidenceMode: "calendar_suggest", status: "active" }),
    true,
  );
  assert.equal(
    canSuggest({ evidenceMode: "self_report", status: "active" }),
    false,
  );
});

test("a paused or retired habit never receives a suggestion", () => {
  for (const status of ["paused", "retired"] as const) {
    assert.equal(
      canSuggest({ evidenceMode: "calendar_suggest", status }),
      false,
      `${status} must not be suggestible`,
    );
  }
});

test("a cycle defaults to six weeks and accepts a longer one", () => {
  assert.equal(cycleEndsAt(START), START + 42 * DAY);
  assert.equal(cycleEndsAt(START, 8), START + 56 * DAY);
});

test("a cycle is active between its start and end", () => {
  const cycle = { startsAt: START, endsAt: cycleEndsAt(START) };
  assert.equal(isCycleActive(cycle, START + DAY), true);
  assert.equal(isCycleActive(cycle, START - DAY), false);
  assert.equal(isCycleActive(cycle, START + 60 * DAY), false);
});

test("trajectory counts each level and ignores unlogged days", () => {
  const t = summarizeTrajectory([
    { date: "2026-08-01", level: "standard" },
    { date: "2026-08-02", level: "minimum" },
    { date: "2026-08-03", level: null },
    { date: "2026-08-04", level: "beyond" },
  ]);
  assert.equal(t.logged, 3);
  assert.equal(t.byLevel.standard, 1);
  assert.equal(t.byLevel.minimum, 1);
  assert.equal(t.byLevel.beyond, 1);
  assert.equal(t.byLevel.missed, 0);
});

test("an intentional skip is not a gap", () => {
  // The spec is explicit: a conscious skip carries no penalty.
  const t = summarizeTrajectory([
    { date: "2026-08-01", level: "standard" },
    { date: "2026-08-02", level: "skipped" },
    { date: "2026-08-03", level: "standard" },
  ]);
  assert.equal(t.longestGap, 0);
  assert.equal(t.returns, 0);
});

test("returning after a gap is counted — the metric on display", () => {
  const t = summarizeTrajectory([
    { date: "2026-08-01", level: "standard" },
    { date: "2026-08-02", level: null },
    { date: "2026-08-03", level: "missed" },
    { date: "2026-08-04", level: "minimum" },
    { date: "2026-08-05", level: null },
    { date: "2026-08-06", level: "standard" },
  ]);
  assert.equal(t.longestGap, 2);
  assert.equal(t.returns, 2);
});

test("a trailing gap is not a return until practice resumes", () => {
  const t = summarizeTrajectory([
    { date: "2026-08-01", level: "standard" },
    { date: "2026-08-02", level: null },
  ]);
  assert.equal(t.returns, 0);
  assert.equal(t.longestGap, 1);
});

test("an empty range summarizes to zeroes rather than throwing", () => {
  const t = summarizeTrajectory([]);
  assert.equal(t.logged, 0);
  assert.equal(t.returns, 0);
  assert.equal(t.longestGap, 0);
});

test("every vote level has a counter", () => {
  const t = summarizeTrajectory([]);
  for (const level of VOTE_LEVELS) {
    assert.equal(t.byLevel[level], 0, `${level} must be counted`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/habitsLib.test.ts`
Expected: FAIL with `Cannot find module '.../convex/habitsLib.ts'`

- [ ] **Step 3: Write minimal implementation**

Create `convex/habitsLib.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/habitsLib.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add convex/habitsLib.ts tests/habitsLib.test.ts
git commit -m "feat(habits): pure helpers for cycles, suggestion eligibility, trajectory

An intentional skip neither extends nor closes a gap — the spec treats it as
a decision, not a lapse. Returns-after-gap is the metric the module displays;
there is deliberately no streak count."
```

---

### Task 2: Schema and core Convex functions

**Files:**
- Modify: `convex/schema.ts` (append five tables before the closing `});`)
- Create: `convex/habits.ts`
- Test: `tests/habitsGuardrails.test.ts`

**Interfaces:**
- Consumes: `VOTE_LEVELS`, `EVIDENCE_MODES`, `HABIT_STATUSES`, `canSuggest` from `convex/habitsLib.ts`; `checkToolSecret`, `markToolHealthy` from `convex/secondBrain.ts`; `requireUser` from `convex/dashboard.ts`; `chicagoToday` from `convex/workflowLib.ts`
- Produces: queries `habits.today`, `habits.list`, `habits.trajectory`, `habits.weekFriction`; mutations `habits.logVote`, `habits.upsertHabit`, `habits.logFriction`, `habits.suggestFromEvidence`, `habits.resolveSuggestion`

- [ ] **Step 1: Write the failing test**

Create `tests/habitsGuardrails.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The module's central promise is that inferred evidence can never mark a
// habit done. These scan the source the way the mail no-send and browser
// no-credentials tripwires do.

const habits = readFileSync(
  new URL("../convex/habits.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../convex/schema.ts", import.meta.url),
  "utf8",
);

test("the suggestion path never inserts a vote", () => {
  const fn = habits.slice(
    habits.indexOf("export const suggestFromEvidence"),
    habits.indexOf("export const resolveSuggestion"),
  );
  assert.ok(fn.length > 0, "suggestFromEvidence must exist");
  assert.ok(
    !/insert\(\s*"habitVotes"/.test(fn),
    "suggestFromEvidence must not write a vote",
  );
  assert.match(fn, /insert\(\s*"habitSuggestions"/);
});

test("suggestions are gated by canSuggest, not by the caller", () => {
  assert.match(habits, /canSuggest\(/);
});

test("evidenceMode defaults to self_report in the schema", () => {
  assert.match(schema, /evidenceMode:\s*v\.optional\(/);
  assert.match(habits, /evidenceMode\s*\?\?\s*"self_report"/);
});

test("no streak counter exists anywhere in the module", () => {
  for (const src of [habits, schema]) {
    assert.ok(!/streak/i.test(src), "the design has no streak concept");
  }
});

test("votes are unique per habit per day — lookup before insert", () => {
  const fn = habits.slice(
    habits.indexOf("export const logVote"),
    habits.indexOf("export const upsertHabit"),
  );
  assert.match(fn, /by_habit_date/);
  assert.match(fn, /ctx\.db\.patch\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/habitsGuardrails.test.ts`
Expected: FAIL — `ENOENT` for `convex/habits.ts`

- [ ] **Step 3a: Add the schema**

In `convex/schema.ts`, add these imports at the top alongside the existing ones:

```ts
import { VOTE_LEVELS, EVIDENCE_MODES, HABIT_STATUSES } from "./habitsLib.ts";
```

Then add these tables inside `defineSchema({ ... })`, before the closing brace:

```ts
  habitCycles: defineTable({
    startsAt: v.number(),
    endsAt: v.number(),
    status: v.union(v.literal("active"), v.literal("closed")),
    note: v.optional(v.string()),
  }),

  habits: defineTable({
    cycleId: v.id("habitCycles"),
    pillar: v.string(),
    identity: v.string(),
    telosItemId: v.optional(v.id("telosItems")),
    minimumAction: v.string(),
    standardAction: v.string(),
    growthAction: v.optional(v.string()),
    cue: v.string(),
    habitStack: v.optional(v.string()),
    backupPlan: v.optional(v.string()),
    obvious: v.optional(v.string()),
    attractive: v.optional(v.string()),
    easy: v.optional(v.string()),
    satisfying: v.optional(v.string()),
    // Optional so existing rows and terse creates default to self_report,
    // which is the private setting.
    evidenceMode: v.optional(
      v.union(...EVIDENCE_MODES.map((m) => v.literal(m))),
    ),
    status: v.union(...HABIT_STATUSES.map((s) => v.literal(s))),
    order: v.number(),
  }).index("by_cycle", ["cycleId"]),

  habitVotes: defineTable({
    habitId: v.id("habits"),
    date: v.string(),
    level: v.union(...VOTE_LEVELS.map((l) => v.literal(l))),
    note: v.optional(v.string()),
    source: v.union(
      v.literal("voice"),
      v.literal("ui"),
      v.literal("suggestion_accepted"),
    ),
  }).index("by_habit_date", ["habitId", "date"]),

  habitSuggestions: defineTable({
    habitId: v.id("habits"),
    date: v.string(),
    reason: v.string(),
    source: v.literal("calendar"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("dismissed"),
    ),
  }).index("by_habit_date", ["habitId", "date"]),

  habitFriction: defineTable({
    habitId: v.id("habits"),
    date: v.string(),
    text: v.string(),
    variableChanged: v.optional(v.string()),
  }).index("by_habit", ["habitId"]),
```

- [ ] **Step 3b: Write the Convex functions**

Create `convex/habits.ts`:

```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret, markToolHealthy } from "./secondBrain";
import { requireUser } from "./dashboard";
import { chicagoToday } from "./workflowLib.ts";
import {
  canSuggest,
  summarizeTrajectory,
  VOTE_LEVELS,
  EVIDENCE_MODES,
  HABIT_STATUSES,
  type DayVote,
  type VoteLevel,
} from "./habitsLib.ts";

// Habits (MOO-505). Identity votes, graded completion, and a hard rule:
// inferred evidence may only ever propose. See suggestFromEvidence.

const voteLevel = v.union(...VOTE_LEVELS.map((l) => v.literal(l)));
const evidenceMode = v.union(...EVIDENCE_MODES.map((m) => v.literal(m)));
const habitStatus = v.union(...HABIT_STATUSES.map((s) => v.literal(s)));

async function activeCycle(ctx: { db: any }) {
  return await ctx.db
    .query("habitCycles")
    .filter((q: any) => q.eq(q.field("status"), "active"))
    .first();
}

async function activeHabits(ctx: { db: any }) {
  const cycle = await activeCycle(ctx);
  if (!cycle) return [];
  const rows = await ctx.db
    .query("habits")
    .withIndex("by_cycle", (q: any) => q.eq("cycleId", cycle._id))
    .collect();
  return rows
    .filter((h: any) => h.status === "active")
    .sort((a: any, b: any) => a.order - b.order);
}

/** Today's habits with their vote and any pending suggestion. */
export const today = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const date = chicagoToday();
    const habits = await activeHabits(ctx);
    return await Promise.all(
      habits.map(async (h: any) => {
        const vote = await ctx.db
          .query("habitVotes")
          .withIndex("by_habit_date", (q: any) =>
            q.eq("habitId", h._id).eq("date", date),
          )
          .unique();
        const suggestion = await ctx.db
          .query("habitSuggestions")
          .withIndex("by_habit_date", (q: any) =>
            q.eq("habitId", h._id).eq("date", date),
          )
          .filter((q: any) => q.eq(q.field("status"), "pending"))
          .first();
        return {
          id: h._id,
          pillar: h.pillar,
          identity: h.identity,
          minimumAction: h.minimumAction,
          standardAction: h.standardAction,
          cue: h.cue,
          evidenceMode: h.evidenceMode ?? "self_report",
          level: vote?.level ?? null,
          note: vote?.note ?? null,
          suggestion: suggestion
            ? { id: suggestion._id, reason: suggestion.reason }
            : null,
        };
      }),
    );
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await activeHabits(ctx);
  },
});

/** Trajectory for one habit over the last `days` days. */
export const trajectory = query({
  args: { habitId: v.id("habits"), days: v.optional(v.number()) },
  handler: async (ctx, { habitId, days = 30 }) => {
    await requireUser(ctx);
    const votes = await ctx.db
      .query("habitVotes")
      .withIndex("by_habit_date", (q) => q.eq("habitId", habitId))
      .collect();
    const byDate = new Map(votes.map((v_) => [v_.date, v_.level as VoteLevel]));
    const series: DayVote[] = [];
    const now = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      const date = chicagoToday(new Date(now - i * 24 * 60 * 60 * 1000));
      series.push({ date, level: byDate.get(date) ?? null });
    }
    return { series, summary: summarizeTrajectory(series) };
  },
});

/** One vote per habit per day: look up by index, then patch or insert. */
export const logVote = mutation({
  args: {
    secret: v.optional(v.string()),
    habitId: v.id("habits"),
    level: voteLevel,
    note: v.optional(v.string()),
    source: v.union(
      v.literal("voice"),
      v.literal("ui"),
      v.literal("suggestion_accepted"),
    ),
  },
  handler: async (ctx, { secret, habitId, level, note, source }) => {
    if (secret) checkToolSecret(secret);
    else await requireUser(ctx);

    const habit = await ctx.db.get(habitId);
    if (!habit) throw new Error("No such habit.");
    if (habit.status !== "active") {
      throw new Error(`That habit is ${habit.status}.`);
    }

    const date = chicagoToday();
    const existing = await ctx.db
      .query("habitVotes")
      .withIndex("by_habit_date", (q) =>
        q.eq("habitId", habitId).eq("date", date),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { level, note, source });
    } else {
      await ctx.db.insert("habitVotes", { habitId, date, level, note, source });
    }
    if (secret) await markToolHealthy(ctx, "log_habit_vote");
    return { date, level };
  },
});

export const upsertHabit = mutation({
  args: {
    secret: v.optional(v.string()),
    habitId: v.optional(v.id("habits")),
    pillar: v.optional(v.string()),
    identity: v.optional(v.string()),
    minimumAction: v.optional(v.string()),
    standardAction: v.optional(v.string()),
    cue: v.optional(v.string()),
    backupPlan: v.optional(v.string()),
    evidenceMode: v.optional(evidenceMode),
    status: v.optional(habitStatus),
  },
  handler: async (ctx, { secret, habitId, ...fields }) => {
    if (secret) checkToolSecret(secret);
    else await requireUser(ctx);

    if (habitId) {
      const clean = Object.fromEntries(
        Object.entries(fields).filter(([, v_]) => v_ !== undefined),
      );
      await ctx.db.patch(habitId, clean);
      if (secret) await markToolHealthy(ctx, "update_habit");
      return { id: habitId };
    }

    let cycle = await activeCycle(ctx);
    if (!cycle) {
      const startsAt = Date.now();
      const id = await ctx.db.insert("habitCycles", {
        startsAt,
        endsAt: startsAt + 42 * 24 * 60 * 60 * 1000,
        status: "active",
      });
      cycle = await ctx.db.get(id);
    }

    const siblings = await ctx.db
      .query("habits")
      .withIndex("by_cycle", (q) => q.eq("cycleId", cycle!._id))
      .collect();

    const id = await ctx.db.insert("habits", {
      cycleId: cycle!._id,
      pillar: fields.pillar ?? "Untitled pillar",
      identity: fields.identity ?? "",
      minimumAction: fields.minimumAction ?? "",
      standardAction: fields.standardAction ?? "",
      cue: fields.cue ?? "",
      backupPlan: fields.backupPlan,
      // Private unless deliberately opened up.
      evidenceMode: fields.evidenceMode ?? "self_report",
      status: fields.status ?? "active",
      order: siblings.length,
    });
    if (secret) await markToolHealthy(ctx, "add_habit");
    return { id };
  },
});

/** Recent friction for one habit — read by the page and the weekly review. */
export const weekFriction = query({
  args: { habitId: v.id("habits"), secret: v.optional(v.string()) },
  handler: async (ctx, { habitId, secret }) => {
    if (secret) checkToolSecret(secret);
    else await requireUser(ctx);
    const rows = await ctx.db
      .query("habitFriction")
      .withIndex("by_habit", (q) => q.eq("habitId", habitId))
      .order("desc")
      .take(7);
    return rows.map((r) => r.text);
  },
});

export const logFriction = mutation({
  args: {
    secret: v.optional(v.string()),
    habitId: v.id("habits"),
    text: v.string(),
  },
  handler: async (ctx, { secret, habitId, text }) => {
    if (secret) checkToolSecret(secret);
    else await requireUser(ctx);
    await ctx.db.insert("habitFriction", {
      habitId,
      date: chicagoToday(),
      text,
    });
    if (secret) await markToolHealthy(ctx, "log_friction");
    return { ok: true };
  },
});

/* Inferred evidence proposes; it never commits. This function has no path to
 * habitVotes, and a source-scan test keeps it that way. A self_report habit
 * is rejected here, at the mutation, not in the UI. */
export const suggestFromEvidence = mutation({
  args: {
    secret: v.string(),
    habitId: v.id("habits"),
    reason: v.string(),
  },
  handler: async (ctx, { secret, habitId, reason }) => {
    checkToolSecret(secret);
    const habit = await ctx.db.get(habitId);
    if (!habit) return { created: false, why: "no such habit" };

    if (
      !canSuggest({
        evidenceMode: habit.evidenceMode ?? "self_report",
        status: habit.status,
      })
    ) {
      return { created: false, why: "habit is self-report only" };
    }

    const date = chicagoToday();
    const existing = await ctx.db
      .query("habitSuggestions")
      .withIndex("by_habit_date", (q) =>
        q.eq("habitId", habitId).eq("date", date),
      )
      .first();
    if (existing) return { created: false, why: "already suggested today" };

    await ctx.db.insert("habitSuggestions", {
      habitId,
      date,
      reason,
      source: "calendar",
      status: "pending",
    });
    return { created: true };
  },
});

/** Accepting a suggestion is what turns evidence into a vote — a human act. */
export const resolveSuggestion = mutation({
  args: {
    suggestionId: v.id("habitSuggestions"),
    accept: v.boolean(),
    level: v.optional(voteLevel),
  },
  handler: async (ctx, { suggestionId, accept, level }) => {
    await requireUser(ctx);
    const suggestion = await ctx.db.get(suggestionId);
    if (!suggestion) throw new Error("No such suggestion.");

    await ctx.db.patch(suggestionId, {
      status: accept ? "accepted" : "dismissed",
    });
    if (!accept) return { voted: false };

    const existing = await ctx.db
      .query("habitVotes")
      .withIndex("by_habit_date", (q) =>
        q.eq("habitId", suggestion.habitId).eq("date", suggestion.date),
      )
      .unique();
    const payload = {
      level: level ?? ("standard" as const),
      source: "suggestion_accepted" as const,
    };
    if (existing) await ctx.db.patch(existing._id, payload);
    else
      await ctx.db.insert("habitVotes", {
        habitId: suggestion.habitId,
        date: suggestion.date,
        ...payload,
      });
    return { voted: true };
  },
});
```

- [ ] **Step 4: Run tests and deploy the schema**

Run: `node --test tests/habitsGuardrails.test.ts`
Expected: PASS, 5 tests

Run: `npx convex deploy -y`
Expected: `Schema validation complete.` then `✔ Deployed Convex functions`

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/habits.ts tests/habitsGuardrails.test.ts
git commit -m "feat(habits): schema and Convex functions with the suggest-never-vote rule

suggestFromEvidence has no path to habitVotes and rejects self_report habits
at the mutation rather than in the UI. Votes are unique per habit per day via
by_habit_date lookup-then-patch, so logging twice cannot inflate trajectory."
```

---

### Task 3: Voice tools

**Files:**
- Modify: `src/app/api/tools/[tool]/route.ts` (add five `case` blocks in the switch)
- Modify: `scripts/provision-agent.ts` (add five entries to `TOOLS`)
- Test: `tests/habitsGuardrails.test.ts` (append)

**Interfaces:**
- Consumes: `api.habits.today`, `api.habits.logVote`, `api.habits.upsertHabit`, `api.habits.logFriction` from Task 2
- Produces: webhook tools `get_habits`, `log_habit_vote`, `add_habit`, `update_habit`, `log_friction`

- [ ] **Step 1: Write the failing test**

Append to `tests/habitsGuardrails.test.ts`:

```ts
test("every habit tool exists in both the route and the provisioning script", () => {
  const route = readFileSync(
    new URL("../src/app/api/tools/[tool]/route.ts", import.meta.url),
    "utf8",
  );
  const provision = readFileSync(
    new URL("../scripts/provision-agent.ts", import.meta.url),
    "utf8",
  );
  for (const tool of [
    "get_habits",
    "log_habit_vote",
    "add_habit",
    "update_habit",
    "log_friction",
  ]) {
    assert.match(route, new RegExp(`case "${tool}"`), `route missing ${tool}`);
    assert.match(
      provision,
      new RegExp(`name: "${tool}"`),
      `provisioning missing ${tool}`,
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/habitsGuardrails.test.ts`
Expected: FAIL — `route missing get_habits`

- [ ] **Step 3a: Add the route cases**

In `src/app/api/tools/[tool]/route.ts`, add inside the switch alongside the existing cases:

```ts
    case "get_habits": {
      const rows = await convex.query(api.habits.today, {});
      if (rows.length === 0) {
        return {
          ok: true,
          message: "You don't have any active habits yet. Want to set one up?",
        };
      }
      const done = rows.filter((r) => r.level);
      const open = rows.filter((r) => !r.level);
      const openList = open.map((r) => r.pillar).join(", ");
      return {
        ok: true,
        message:
          open.length === 0
            ? `All ${rows.length} votes are in for today.`
            : `${done.length} of ${rows.length} votes are in. Still open: ${openList}.`,
        data: rows,
      };
    }
    case "log_habit_vote": {
      const habitId = strArg(body.habit_id, 64);
      const level = strArg(body.level, 20);
      if (!habitId || !level) {
        return { ok: false, message: "Which habit, and at what level?" };
      }
      await convex.mutation(api.habits.logVote, {
        secret,
        habitId: habitId as Id<"habits">,
        level: level as "minimum" | "standard" | "beyond" | "skipped" | "missed",
        note: strArg(body.note, 400) || undefined,
        source: "voice",
      });
      return { ok: true, message: "Logged." };
    }
    case "add_habit": {
      const res = await convex.mutation(api.habits.upsertHabit, {
        secret,
        pillar: strArg(body.pillar, 80) || undefined,
        identity: strArg(body.identity, 200) || undefined,
        minimumAction: strArg(body.minimum_action, 200) || undefined,
        standardAction: strArg(body.standard_action, 200) || undefined,
        cue: strArg(body.cue, 200) || undefined,
        backupPlan: strArg(body.backup_plan, 200) || undefined,
      });
      return {
        ok: true,
        message: "Added. That's the system — the vote is what counts.",
        data: res,
      };
    }
    case "update_habit": {
      const habitId = strArg(body.habit_id, 64);
      if (!habitId) return { ok: false, message: "Which habit?" };
      await convex.mutation(api.habits.upsertHabit, {
        secret,
        habitId: habitId as Id<"habits">,
        minimumAction: strArg(body.minimum_action, 200) || undefined,
        cue: strArg(body.cue, 200) || undefined,
        backupPlan: strArg(body.backup_plan, 200) || undefined,
        status:
          (strArg(body.status, 20) as "active" | "paused" | "retired") ||
          undefined,
      });
      return { ok: true, message: "Updated." };
    }
    case "log_friction": {
      const habitId = strArg(body.habit_id, 64);
      const text = strArg(body.text, 400);
      if (!habitId || !text) {
        return { ok: false, message: "Which habit, and what got in the way?" };
      }
      await convex.mutation(api.habits.logFriction, {
        secret,
        habitId: habitId as Id<"habits">,
        text,
      });
      return {
        ok: true,
        message: "Noted. We'll change one thing at the weekly review.",
      };
    }
```

If `Id` is not already imported in this file, add:

```ts
import type { Id } from "../../../../../convex/_generated/dataModel";
```

- [ ] **Step 3b: Add the provisioning entries**

In `scripts/provision-agent.ts`, add these to the `TOOLS` array:

```ts
  {
    type: "webhook" as const,
    name: "get_habits",
    description:
      "Read today's habit votes: which identity votes are already in, and which are still open. Use this before the evening check-in.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/get_habits`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        description: "No arguments",
        properties: {},
      },
    },
  },
  {
    type: "webhook" as const,
    name: "log_habit_vote",
    description:
      "Record today's vote for one habit. Levels are minimum, standard, beyond, skipped, or missed. A skip is a conscious choice and carries no penalty — never treat it as a failure, and never log a vote Tarik has not confirmed.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/log_habit_vote`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["habit_id", "level"],
        description: "The vote",
        properties: {
          habit_id: bodyProp("The habit's id, from get_habits"),
          level: bodyProp(
            "One of: minimum, standard, beyond, skipped, missed",
          ),
          note: bodyProp("Optional: what actually happened, in his words"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "add_habit",
    description:
      "Create a habit after walking through the protocol: what identity is this a vote for, what is the standard daily action, what is the two-minute minimum for a low-energy day, and what is the cue. Ask those one at a time before calling this.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/add_habit`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["pillar", "identity", "minimum_action", "standard_action", "cue"],
        description: "The habit design",
        properties: {
          pillar: bodyProp("Life area, e.g. 'Work / Craft' or 'Health'"),
          identity: bodyProp("I am the kind of person who…"),
          minimum_action: bodyProp("Two minutes or less; doable on a bad day"),
          standard_action: bodyProp("The normal daily practice"),
          cue: bodyProp("At TIME, in PLACE, I will X"),
          backup_plan: bodyProp("Optional: if DISRUPTION, then SMALLER ACTION"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "update_habit",
    description:
      "Change one variable on a habit — the cue, the minimum, the backup plan — or pause/retire it. Change only one thing at a time so it's clear what helped. Pausing is not failing.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/update_habit`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["habit_id"],
        description: "The change",
        properties: {
          habit_id: bodyProp("The habit's id, from get_habits"),
          minimum_action: bodyProp("Optional: a new, smaller minimum"),
          cue: bodyProp("Optional: a new cue"),
          backup_plan: bodyProp("Optional: a new if-then plan"),
          status: bodyProp("Optional: active, paused, or retired"),
        },
      },
    },
  },
  {
    type: "webhook" as const,
    name: "log_friction",
    description:
      "Record what made a habit hard today. Use this when Tarik describes resistance — it feeds the weekly redesign. Respond with curiosity about the system, never with judgement about him.",
    responseTimeoutSecs: 20,
    apiSchema: {
      url: `${TOOL_BASE_URL}/log_friction`,
      method: "POST" as const,
      requestHeaders: { "x-morpheus-secret": env.MORPHEUS_TOOL_SECRET },
      requestBodySchema: {
        type: "object" as const,
        required: ["habit_id", "text"],
        description: "The friction",
        properties: {
          habit_id: bodyProp("The habit's id, from get_habits"),
          text: bodyProp("What got in the way, in his words"),
        },
      },
    },
  },
```

- [ ] **Step 4: Verify, build, provision**

Run: `node --test tests/habitsGuardrails.test.ts`
Expected: PASS, 6 tests

Run: `npm run build`
Expected: `✓ Compiled successfully`

Run: `node scripts/provision-agent.ts`
Expected: `Updated agent agent_…`

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/tools/[tool]/route.ts" scripts/provision-agent.ts tests/habitsGuardrails.test.ts
git commit -m "feat(habits): five voice tools, self-registering in /control

Tool descriptions carry the module's tone rules into the agent: a skip is a
choice not a failure, change one variable at a time, and never log a vote
Tarik has not confirmed."
```

---

### Task 4: The HABITS page

**Files:**
- Modify: `src/app/globals.css` (add the sage token)
- Modify: `src/components/NavRail.tsx` (add the rail entry)
- Modify: `DESIGN.md` (record the new channel colour)
- Create: `src/app/habits/page.tsx`
- Create: `src/components/habits/VoteRow.tsx`
- Create: `src/components/habits/TrajectoryStrip.tsx`

**Interfaces:**
- Consumes: `api.habits.today`, `api.habits.trajectory`, `api.habits.logVote`, `api.habits.resolveSuggestion` from Task 2; `Zone` / `ZoneEmpty` from `src/components/hud/Zone`
- Produces: the `/habits` route

- [ ] **Step 1: Add the channel colour**

In `src/app/globals.css`, add to `:root`:

```css
  --lcars-sage: #99cc99;
```

and to the `@theme inline` block:

```css
  --color-sage: var(--lcars-sage);
```

In `DESIGN.md`, add to the Colors → Secondary list:

```markdown
- **LCARS Sage** (#99cc99): Channel colour for HABITS. Follows the palette's
  `99`/`cc` construction, so it takes black cap type like its siblings.
```

- [ ] **Step 2: Add the rail entry**

In `src/components/NavRail.tsx`, add to the `LINKS` array after the TELOS entry:

```ts
  { label: "HABITS", href: "/habits", color: "bg-sage" },
```

- [ ] **Step 3: Build the vote row**

Create `src/components/habits/VoteRow.tsx`:

```tsx
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

      <div className="mt-3 flex flex-wrap gap-2">
        {LEVELS.map((l) => (
          <button
            key={l.key}
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
```

- [ ] **Step 4: Build the trajectory strip**

Create `src/components/habits/TrajectoryStrip.tsx`:

```tsx
"use client";

// A blocky heatmap of levels. There is deliberately no streak number here —
// the figure worth showing is how often practice resumed after a gap.
const LEVEL_COLOR: Record<string, string> = {
  minimum: "bg-sage/40",
  standard: "bg-sage/70",
  beyond: "bg-sage",
  skipped: "bg-steel/40",
  missed: "bg-salmon/40",
};

export function TrajectoryStrip({
  series,
  summary,
}: {
  series: { date: string; level: string | null }[];
  summary: { logged: number; returns: number; longestGap: number };
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {series.map((d) => (
          <span
            key={d.date}
            title={`${d.date}${d.level ? ` · ${d.level}` : ""}`}
            className={`h-3 w-3 rounded-[2px] ${
              d.level ? LEVEL_COLOR[d.level] : "bg-panel-edge"
            }`}
          />
        ))}
      </div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-steel">
        {summary.logged} logged · came back {summary.returns}×· longest gap{" "}
        {summary.longestGap}d
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Build the page**

Create `src/app/habits/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { VoteRow } from "@/components/habits/VoteRow";
import { TrajectoryStrip } from "@/components/habits/TrajectoryStrip";

export default function HabitsPage() {
  const habits = useQuery(api.habits.today);
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
        {traj === undefined ? (
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
```

- [ ] **Step 6: Add the field note**

The spec's right panel carries a short rotating principle chosen against
recent progress. Create `src/components/habits/FieldNote.tsx`:

```tsx
"use client";

// A short principle from the research, chosen by what the trajectory shows.
// Deliberately not a motivational quote generator — three states, three notes.
export function FieldNote({
  returns,
  logged,
}: {
  returns: number;
  logged: number;
}) {
  const note =
    logged === 0
      ? "A habit isn't active until the cue, the minimum and the confirmation are clear. Start by naming when and where."
      : returns > 0
        ? "Coming back is the skill. The tracker measures return, not perfection — a gap you closed is evidence the system works."
        : "On a hard day, take the two-minute version. Continuity protects the identity; capacity can grow later.";

  return (
    <div className="rounded-lg border border-panel-edge bg-panel p-4">
      <h3 className="mb-2 border-b border-panel-edge pb-2 text-[10px] uppercase tracking-[0.3em] text-cyan-hud">
        Field note
      </h3>
      <p className="font-[family-name:var(--font-mono-hud)] text-xs leading-6 text-foreground/85">
        {note}
      </p>
    </div>
  );
}
```

Add the import to `src/app/habits/page.tsx`:

```tsx
import { FieldNote } from "@/components/habits/FieldNote";
```

- [ ] **Step 7: Verify and commit**

Run: `npm run build`
Expected: `✓ Compiled successfully`, and `/habits` in the route list

Run: `npm test`
Expected: PASS, all tests

```bash
git add src/app/habits src/components/habits src/app/globals.css src/components/NavRail.tsx DESIGN.md
git commit -m "feat(habits): HABITS page, sage channel colour, graded vote rows, field note

Suggestions render as questions to accept or dismiss, never as pre-ticked
rows. The trajectory strip shows returns-after-gap; no streak number exists."
```

---

### Task 5: Evening check-in and calendar suggestions

**Files:**
- Create: `convex/habitsCron.ts`
- Modify: `convex/crons.ts` (add one cron)
- Test: `tests/habitsGuardrails.test.ts` (append)

**Interfaces:**
- Consumes: `api.habits.today`, `api.habits.suggestFromEvidence` from Task 2; `pushBriefingCards` from `convex/secondBrain.ts`
- Produces: `internal.habitsCron.eveningCheckIn`

- [ ] **Step 1: Write the failing test**

Append to `tests/habitsGuardrails.test.ts`:

```ts
test("the evening check-in cannot nag — it composes a card and stops", () => {
  const cron = readFileSync(
    new URL("../convex/habitsCron.ts", import.meta.url),
    "utf8",
  );
  // No push channel exists yet (MOO-497); the check-in must wait like the
  // morning brief rather than reaching out.
  assert.ok(!/sms|twilio|telnyx|notify/i.test(cron));
  assert.match(cron, /insert\("briefingCards"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/habitsGuardrails.test.ts`
Expected: FAIL — `ENOENT` for `convex/habitsCron.ts`

- [ ] **Step 3: Write the cron action**

Create `convex/habitsCron.ts`:

```ts
import { internalMutation } from "./_generated/server";
import { chicagoToday } from "./workflowLib.ts";

/* Evening check-in (MOO-505). Composes a card that waits on the dashboard,
 * exactly as the morning brief does. There is no push channel yet, and that
 * is deliberate — this cannot nag, by construction. When MOO-497 lands, an
 * SMS nudge can read the same card. */
export const eveningCheckIn = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cycle = await ctx.db
      .query("habitCycles")
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (!cycle) return;

    const habits = (
      await ctx.db
        .query("habits")
        .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
        .collect()
    ).filter((h) => h.status === "active");
    if (habits.length === 0) return;

    const date = chicagoToday();
    const open: string[] = [];
    for (const habit of habits) {
      const vote = await ctx.db
        .query("habitVotes")
        .withIndex("by_habit_date", (q) =>
          q.eq("habitId", habit._id).eq("date", date),
        )
        .unique();
      if (!vote) open.push(habit.pillar);
    }

    await ctx.db.insert("briefingCards", {
      kind: "note",
      title: open.length === 0 ? "All votes are in" : "Evening check-in",
      body:
        open.length === 0
          ? `Every pillar has a vote today. Anything worth noting before you close the day?`
          : `Still open: ${open.join(", ")}. Which of these happened today?`,
    });
  },
});
```

- [ ] **Step 4: Schedule it**

In `convex/crons.ts`, add:

```ts
// Evening habit check-in. 23:00 UTC = 6:00 PM CDT (5:00 PM CST). It composes
// a card and waits — see convex/habitsCron.ts.
crons.cron(
  "habit evening check-in",
  "0 23 * * *",
  internal.habitsCron.eveningCheckIn,
  {},
);
```

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/habitsGuardrails.test.ts`
Expected: PASS, 7 tests

Run: `npx convex deploy -y`
Expected: `✔ Deployed Convex functions`

```bash
git add convex/habitsCron.ts convex/crons.ts tests/habitsGuardrails.test.ts
git commit -m "feat(habits): evening check-in cron that waits rather than nags

It composes a briefing card the way the morning brief does. A test asserts no
push path exists here, so the no-nagging property survives MOO-497 landing."
```

---

### Task 6: Habits section in the Sunday weekly review

**Files:**
- Modify: `convex/habitsLib.ts` (add `buildHabitReview`)
- Modify: `tests/habitsLib.test.ts` (append)
- Modify: `src/app/api/tools/[tool]/route.ts` (add the `habit_review` step case)
- Modify: `convex/workflows.ts:302` (add the step to `WEEKLY_REVIEW_STEPS`)
- Modify: `convex/workflowLib.ts:31` (add the section label)

**Interfaces:**
- Consumes: `summarizeTrajectory` from Task 1; `api.habits.list` from Task 2
- Produces: `buildHabitReview(habits, now)` returning a markdown section string; the `habit_review` workflow step

The existing weekly review is a workflow whose steps are
`{ tool: "telos_brief" }` and `{ tool: "journal_digest" }`. Each step is a
case in the tool route that returns `{ data: { body } }`, and the runner
stitches the bodies into the brief under a label from `TOOL_LABELS`. A habits
section is one more step in exactly that shape.

- [ ] **Step 1: Write the failing test**

Append to `tests/habitsLib.test.ts`:

```ts
import { buildHabitReview } from "../convex/habitsLib.ts";

test("the review names the most frictional habit and asks for one change", () => {
  const body = buildHabitReview(
    [
      {
        pillar: "Work / Craft",
        days: [
          { date: "2026-08-01", level: "standard" },
          { date: "2026-08-02", level: null },
          { date: "2026-08-03", level: "minimum" },
        ],
        friction: ["back-to-back meetings"],
      },
      {
        pillar: "Health",
        days: [{ date: "2026-08-01", level: "missed" }],
        friction: [],
      },
    ],
  );
  assert.match(body, /Work \/ Craft/);
  assert.match(body, /back-to-back meetings/);
  assert.match(body, /one variable/i);
  // The review must never present a streak.
  assert.ok(!/streak/i.test(body));
});

test("an empty week still produces a usable review", () => {
  const body = buildHabitReview([]);
  assert.match(body, /no active habits/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/habitsLib.test.ts`
Expected: FAIL — `buildHabitReview is not a function`

- [ ] **Step 3: Implement it**

Append to `convex/habitsLib.ts`:

```ts
export type HabitWeek = {
  pillar: string;
  days: DayVote[];
  friction: string[];
};

/* The weekly review section. It reports trajectory and friction, then asks
 * for exactly one change — changing several at once makes it impossible to
 * tell which one helped. */
export function buildHabitReview(weeks: HabitWeek[]): string {
  if (weeks.length === 0) {
    return "No active habits this week. Set a pillar up when you're ready.";
  }

  const lines: string[] = [];
  for (const week of weeks) {
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
  lines.push(
    "Adjust one variable only: the cue, the size, the location, the backup plan, or pause it.",
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/habitsLib.test.ts`
Expected: PASS, 12 tests

- [ ] **Step 5: Add the workflow step**

In `src/app/api/tools/[tool]/route.ts`, add alongside `telos_brief`:

```ts
    case "habit_review": {
      const [habits] = await Promise.all([
        convex.query(api.habits.list, {}),
        convex.mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "habit_review",
        }),
      ]);
      const weeks = await Promise.all(
        habits.map(async (h) => {
          const traj = await convex.query(api.habits.trajectory, {
            habitId: h._id,
            days: 7,
          });
          const friction = await convex.query(api.habits.weekFriction, {
            habitId: h._id,
            secret,
          });
          return { pillar: h.pillar, days: traj.series, friction };
        }),
      );
      const body = buildHabitReview(weeks);
      return { ok: true, message: "Habits section built.", data: { body } };
    }
```

Add the import at the top of that file:

```ts
import { buildHabitReview } from "../../../../../convex/habitsLib.ts";
```

`api.habits.weekFriction` already exists from Task 2; the step passes `secret`
because it is called from the tool route rather than a signed-in browser.

In `convex/workflows.ts:302`, extend the steps:

```ts
const WEEKLY_REVIEW_STEPS: { tool: string; args: Record<string, string> }[] = [
  { tool: "telos_brief", args: {} },
  { tool: "habit_review", args: {} },
  { tool: "journal_digest", args: {} },
];
```

In `convex/workflowLib.ts:31`, add the label:

```ts
  habit_review: "Habits",
```

- [ ] **Step 6: Verify and commit**

Run: `npm test`
Expected: PASS, all tests

Run: `npm run build`
Expected: `✓ Compiled successfully`

Run: `npx convex deploy -y` then re-seed so the new step lands:
`npx convex run workflows:seedPhase2 '{}' --prod`
Expected: the weekly-review workflow now lists three steps

```bash
git add convex/habitsLib.ts convex/habits.ts convex/workflows.ts convex/workflowLib.ts "src/app/api/tools/[tool]/route.ts" tests/habitsLib.test.ts
git commit -m "feat(habits): habits section in the Sunday weekly review

Reports trajectory and friction per pillar, then asks for exactly one change —
changing several at once makes it impossible to tell which one helped. A test
asserts the section never presents a streak."
```

---

### Task 7: Tone and escalation rules in the agent instruction

**Files:**
- Modify: `scripts/provision-agent.ts` (extend the agent instruction)
- Test: `tests/habitsGuardrails.test.ts` (append)

**Interfaces:**
- Consumes: the `TOOLS` array and instruction string from Task 3
- Produces: the distress-escalation rule in the provisioned instruction

- [ ] **Step 1: Write the failing test**

Append to `tests/habitsGuardrails.test.ts`:

```ts
test("the agent instruction carries the habit tone and escalation rules", () => {
  const provision = readFileSync(
    new URL("../scripts/provision-agent.ts", import.meta.url),
    "utf8",
  );
  // Same shape as the browse GUARDRAILS test: the rule must be in the
  // instruction, not just in a design document nobody ships.
  assert.match(provision, /HABIT_GUARDRAILS/);
  assert.match(provision, /never shame/i);
  assert.match(provision, /human support/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/habitsGuardrails.test.ts`
Expected: FAIL — no `HABIT_GUARDRAILS`

- [ ] **Step 3: Add the guardrail text**

In `scripts/provision-agent.ts`, add near the other prompt constants:

```ts
const HABIT_GUARDRAILS = `
Habits: a miss is information about the system, never a verdict about Tarik.
Never shame, never guilt, never imply a broken streak — there is no streak.
When something did not happen, ask what got in the way and offer the
two-minute minimum or a reschedule; change one variable at a time.
An intentional skip is a valid choice; record it without penalty.
Relationship, health and reflection habits are his to report — never infer
them from data, and never claim one happened without his word.
If he reports persistent distress, disordered eating, addiction, self-harm or
a relationship-safety concern, stop tracking and point him to human support.
`;
```

Then append it to the agent instruction where the other guardrails are joined.

- [ ] **Step 4: Verify and provision**

Run: `node --test tests/habitsGuardrails.test.ts`
Expected: PASS, 8 tests

Run: `npm test`
Expected: PASS, all tests

Run: `node scripts/provision-agent.ts`
Expected: `Updated agent agent_…`

- [ ] **Step 5: Commit and deploy**

```bash
git add scripts/provision-agent.ts tests/habitsGuardrails.test.ts
git commit -m "feat(habits): tone and escalation rules in the agent instruction

Persistent distress routes to human support instead of more tracking. Tested
the way the browse guardrails are — the rule ships in the instruction, not
only in a design doc."
```

```bash
npx convex deploy -y
vercel deploy --prod --yes
```

---

## Verification checklist

Before calling this done:

- [ ] `npm test` green, including all eight habit tripwires
- [ ] `npm run build` clean, `/habits` in the route list
- [ ] Create a habit by voice, end to end
- [ ] Log a vote by voice, and see it appear on `/habits` without a refresh
- [ ] Log a vote on the page, and hear Zola report it in `get_habits`
- [ ] Confirm a `self_report` habit rejects `suggestFromEvidence`
- [ ] Confirm the trajectory strip shows returns, and no streak count exists anywhere
