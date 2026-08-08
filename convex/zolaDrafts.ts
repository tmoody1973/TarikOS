import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret } from "./secondBrain";

// Zola-draft provenance (MOO-494): ids only. Secret-gated like the other
// tool-facing functions; the /api/mail routes call these server-side.

export const markZolaDraft = mutation({
  args: { secret: v.string(), draftId: v.string(), account: v.string() },
  handler: async (ctx, { secret, draftId, account }) => {
    checkToolSecret(secret);
    const existing = await ctx.db
      .query("zolaDrafts")
      .withIndex("by_draftId", (q) => q.eq("draftId", draftId))
      .unique();
    if (!existing) await ctx.db.insert("zolaDrafts", { draftId, account });
  },
});

export const zolaDraftIds = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    // Newest first so at the ceiling it's the OLD ids that lose their badge.
    // ponytail: 500 cap, no pruning — delete-on-send if this ever matters.
    const rows = await ctx.db.query("zolaDrafts").order("desc").take(500);
    return rows.map((r) => r.draftId);
  },
});
