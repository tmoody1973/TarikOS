import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret } from "./secondBrain";

// Storage for Zola's own inbox.
//
// Deliberately thin. AgentMail owns the messages; this holds what a webhook
// needs and a poll cannot give — idempotency on the message id, and a record of
// who has already had the one automatic reply.

/**
 * Record an accepted message, and say whether it is new.
 *
 * Idempotent on the message id, because a webhook delivery can and will arrive
 * twice. `fresh: false` is the caller's signal to do nothing further — and it
 * is what stops a retried delivery producing a second letter.
 */
export const record = mutation({
  args: {
    secret: v.string(),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    from: v.string(),
    subject: v.string(),
    summary: v.string(),
    receivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    checkToolSecret(args.secret);
    const existing = await ctx.db
      .query("zolaMail")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .unique();
    if (existing) return { fresh: false, id: existing._id };

    const { secret: _secret, ...row } = args;
    const id = await ctx.db.insert("zolaMail", row);
    return { fresh: true, id };
  },
});

/**
 * Whether this sender has ever had the automatic reply.
 *
 * By sender rather than by message: two auto-responders pointed at each other
 * stop only when somebody's provider blocks somebody.
 */
export const hasBeenAnswered = query({
  args: { secret: v.string(), from: v.string() },
  handler: async (ctx, args) => {
    checkToolSecret(args.secret);
    const rows = await ctx.db
      .query("zolaMail")
      .withIndex("by_sender", (q) => q.eq("from", args.from))
      .collect();
    return rows.some((r) => r.autoRepliedAt !== undefined);
  },
});

/** Mark the letter as sent, or record why it was not. */
export const markAnswered = mutation({
  args: {
    secret: v.string(),
    messageId: v.string(),
    at: v.optional(v.number()),
    skipped: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    checkToolSecret(args.secret);
    const row = await ctx.db
      .query("zolaMail")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      autoRepliedAt: args.at,
      autoReplySkipped: args.skipped,
    });
  },
});
