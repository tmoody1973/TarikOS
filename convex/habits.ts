import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
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

async function activeCycle(ctx: QueryCtx) {
  return await ctx.db
    .query("habitCycles")
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();
}

async function activeHabits(ctx: QueryCtx) {
  const cycle = await activeCycle(ctx);
  if (!cycle) return [];
  const rows = await ctx.db
    .query("habits")
    .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
    .collect();
  return rows
    .filter((h) => h.status === "active")
    .sort((a, b) => a.order - b.order);
}

/** Today's habits with their vote and any pending suggestion. */
export const today = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const date = chicagoToday();
    const habits = await activeHabits(ctx);
    return await Promise.all(
      habits.map(async (h) => {
        const vote = await ctx.db
          .query("habitVotes")
          .withIndex("by_habit_date", (q) =>
            q.eq("habitId", h._id).eq("date", date),
          )
          .unique();
        const suggestion = await ctx.db
          .query("habitSuggestions")
          .withIndex("by_habit_date", (q) =>
            q.eq("habitId", h._id).eq("date", date),
          )
          .filter((q) => q.eq(q.field("status"), "pending"))
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
  args: { secret: v.optional(v.string()) },
  handler: async (ctx, { secret }) => {
    if (secret) checkToolSecret(secret);
    else await requireUser(ctx);
    return await activeHabits(ctx);
  },
});

/** Trajectory for one habit over the last `days` days. */
export const trajectory = query({
  args: {
    habitId: v.id("habits"),
    days: v.optional(v.number()),
    secret: v.optional(v.string()),
  },
  handler: async (ctx, { habitId, days = 30, secret }) => {
    if (secret) checkToolSecret(secret);
    else await requireUser(ctx);
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
