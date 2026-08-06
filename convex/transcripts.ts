import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Browser-facing functions: the signed-in Tarik session writes transcript
// turns live during a conversation and browses them in the explorer.
async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity;
}

export const start = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    await requireUser(ctx);
    return await ctx.db.insert("transcripts", {
      title,
      turns: [],
      toolCalls: [],
    });
  },
});

export const appendTurn = mutation({
  args: {
    transcriptId: v.id("transcripts"),
    role: v.union(v.literal("tarik"), v.literal("morpheus")),
    text: v.string(),
  },
  handler: async (ctx, { transcriptId, role, text }) => {
    await requireUser(ctx);
    const transcript = await ctx.db.get(transcriptId);
    if (!transcript) throw new Error("Transcript not found");
    await ctx.db.patch(transcriptId, {
      turns: [...transcript.turns, { role, text, at: Date.now() }],
    });
  },
});

export const logToolCall = mutation({
  args: {
    transcriptId: v.id("transcripts"),
    tool: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
  },
  handler: async (ctx, { transcriptId, tool, status }) => {
    await requireUser(ctx);
    const transcript = await ctx.db.get(transcriptId);
    if (!transcript) throw new Error("Transcript not found");
    await ctx.db.patch(transcriptId, {
      toolCalls: [...transcript.toolCalls, { tool, status, at: Date.now() }],
    });
  },
});

export const get = query({
  args: { transcriptId: v.id("transcripts") },
  handler: async (ctx, { transcriptId }) => {
    await requireUser(ctx);
    return await ctx.db.get(transcriptId);
  },
});

export const searchSecondBrain = query({
  args: { searchQuery: v.string() },
  handler: async (ctx, { searchQuery }) => {
    await requireUser(ctx);
    if (searchQuery.trim() === "") return { thoughts: [], memories: [] };
    const [thoughts, memories] = await Promise.all([
      ctx.db
        .query("thoughts")
        .withSearchIndex("search_cleaned", (q) =>
          q.search("cleaned", searchQuery),
        )
        .take(10),
      ctx.db
        .query("memories")
        .withSearchIndex("search_content", (q) =>
          q.search("content", searchQuery),
        )
        .take(10),
    ]);
    return { thoughts, memories };
  },
});
