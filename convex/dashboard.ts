import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
}

export const briefingCards = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("briefingCards").order("desc").take(20);
  },
});

export const recentThoughts = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("thoughts").order("desc").take(20);
  },
});

export const recentMemories = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("memories").order("desc").take(20);
  },
});

export const recentTranscripts = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("transcripts").order("desc").take(10);
  },
});

export const toolRegistry = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("tools").collect();
  },
});

export const setToolEnabled = mutation({
  args: { toolId: v.id("tools"), enabled: v.boolean() },
  handler: async (ctx, { toolId, enabled }) => {
    await requireUser(ctx);
    await ctx.db.patch(toolId, { enabled });
  },
});

export const seedDemo = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    if (secret !== process.env.MORPHEUS_TOOL_SECRET) throw new Error("Invalid secret");
    const existing = await ctx.db.query("tools").collect();
    if (existing.length > 0) return "already seeded";

    const plannedTools = [
      ["capture_thought", "Capture a spoken idea into the second brain"],
      ["remember", "Store a fact Morpheus learns about Tarik"],
      ["recall", "Semantic search across thoughts, memories, transcripts"],
      ["get_calendar", "Read today's Google Calendar events"],
      ["get_emails", "Read recent priority Gmail messages"],
      ["web_research", "Live search and data via AgentKey"],
      ["update_dashboard", "Push a card to the command center"],
    ] as const;
    for (const [name, description] of plannedTools) {
      await ctx.db.insert("tools", {
        name,
        description,
        enabled: false,
        health: "unknown",
      });
    }
    await ctx.db.insert("briefingCards", {
      kind: "note",
      title: "Systems online",
      body: "Foundation deployed. Voice loop arrives in Milestone 2.",
    });
    return "seeded";
  },
});
