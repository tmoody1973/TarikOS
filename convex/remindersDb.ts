import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { checkToolSecret, markToolHealthy } from "./secondBrain";
import { requireUser } from "./dashboard";
import { REMINDER_CHANNELS } from "./remindersLib.ts";

// Reminder storage and scheduling.
//
// Split from reminders.ts because that file is "use node" for the delivery
// fetch, and a Node action cannot hold the database functions a mutation needs.

const channel = v.union(v.literal("telegram"), v.literal("email"));

/** How many pending reminders can exist at once. A spoken interface can loop. */
const MAX_PENDING = 100;

/**
 * Set one.
 *
 * The row is written BEFORE the fire is scheduled, so a reminder can never be
 * scheduled without something to cancel or list. The other order leaves an
 * invisible timer if the insert fails.
 */
export const schedule = mutation({
  args: {
    secret: v.string(),
    text: v.string(),
    dueAt: v.number(),
    channel,
  },
  handler: async (ctx, { secret, text, dueAt, channel: how }) => {
    checkToolSecret(secret);

    const pending = await ctx.db
      .query("reminders")
      .withIndex("by_status_due", (q) => q.eq("status", "pending"))
      .collect();
    if (pending.length >= MAX_PENDING) {
      return { ok: false as const, reason: "too_many" as const };
    }

    const id = await ctx.db.insert("reminders", {
      text,
      dueAt,
      channel: how,
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAt(dueAt, internal.reminders.fire, { id });
    await markToolHealthy(ctx, "remind_me");
    return { ok: true as const, id };
  },
});

/** What is still coming. Secret-gated, for the voice path. */
export const pending = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_status_due", (q) => q.eq("status", "pending"))
      .collect();
    return rows.map((r) => ({ id: r._id, text: r.text, dueAt: r.dueAt, channel: r.channel }));
  },
});

/** The same list for the dashboard, which has a Clerk session. */
export const pendingForOwner = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_status_due", (q) => q.eq("status", "pending"))
      .collect();
    return rows.sort((a, z) => a.dueAt - z.dueAt);
  },
});

/**
 * Call one off.
 *
 * Sets the status rather than trying to unschedule the fire. The fire still
 * runs at the appointed time, finds a row that is no longer pending, and does
 * nothing — which has no race, unlike cancelling a timer that may already be
 * executing.
 */
export const cancel = mutation({
  args: { secret: v.string(), id: v.id("reminders") },
  handler: async (ctx, { secret, id }) => {
    checkToolSecret(secret);
    const row = await ctx.db.get(id);
    if (!row || row.status !== "pending") return { ok: false as const };
    await ctx.db.patch(id, { status: "cancelled", resolvedAt: Date.now() });
    return { ok: true as const, text: row.text };
  },
});

/** Cancel from the dashboard. Same rule, a session instead of a secret. */
export const cancelForOwner = mutation({
  args: { id: v.id("reminders") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.status !== "pending") return { ok: false as const };
    await ctx.db.patch(id, { status: "cancelled", resolvedAt: Date.now() });
    return { ok: true as const };
  },
});

/** What the fire needs, and only if it is still owed. */
export const claim = internalQuery({
  args: { id: v.id("reminders") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "pending") return null;
    return { text: row.text, channel: row.channel };
  },
});

export const resolve = internalMutation({
  args: {
    id: v.id("reminders"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, error }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "pending") return;
    await ctx.db.patch(id, { status, error, resolvedAt: Date.now() });
  },
});

// Re-exported so a caller that already imports this module does not need the
// pure one just to name a channel.
export { REMINDER_CHANNELS };
