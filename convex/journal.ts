import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret, markToolHealthy } from "./secondBrain";

// Voice journaling (MOO-489). Entries insert first, embed later — the nightly
// consolidation's backfill embeds them, same as thoughts/memories. A Voyage
// outage delays semantics, never loses the entry.

export const addEntry = mutation({
  args: {
    secret: v.string(),
    text: v.string(),
    mode: v.union(v.literal("capture"), v.literal("reflection")),
  },
  handler: async (ctx, { secret, text, mode }): Promise<string> => {
    checkToolSecret(secret);
    const id = await ctx.db.insert("journalEntries", { text, mode });
    await markToolHealthy(ctx, "journal_entry");
    return id;
  },
});

// weekly-review's journal_digest step: the last 7 days of entries.
export const weekEntries = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", since))
      .order("desc")
      .collect();
    return entries.map(({ embedding: _e, ...rest }) => rest);
  },
});

export const stampConsolidated = internalMutation({
  args: { ids: v.array(v.id("journalEntries")) },
  handler: async (ctx, { ids }): Promise<void> => {
    const now = Date.now();
    await Promise.all(
      ids.map(async (id) => {
        if (await ctx.db.get(id)) {
          await ctx.db.patch(id, { consolidatedAt: now });
        }
      }),
    );
  },
});
