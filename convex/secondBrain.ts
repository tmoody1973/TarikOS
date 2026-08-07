import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Tool-facing functions, called by the Next.js tool webhook routes on behalf
// of the ElevenLabs agent. They authenticate with a shared secret rather than
// a user identity — the caller is Morpheus, not a browser session.
export function checkToolSecret(secret: string) {
  const expected = process.env.MORPHEUS_TOOL_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Invalid tool secret");
  }
}

export async function markToolHealthy(ctx: MutationCtx, name: string) {
  const tool = await ctx.db
    .query("tools")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
  if (!tool) {
    await ctx.db.insert("tools", {
      name,
      description: "Registered automatically on first successful call",
      enabled: true,
      health: "ok",
    });
  } else if (tool.health !== "ok" || !tool.enabled) {
    await ctx.db.patch(tool._id, {
      health: "ok",
      enabled: true,
      lastError: undefined,
    });
  }
}

// Gate for every incoming tool call: a tool that exists and has been
// explicitly disabled (i.e. it has run before — health isn't "unknown")
// is genuinely unavailable. Unknown/unregistered tools are allowed so
// first use can auto-register them.
export const toolGate = query({
  args: { secret: v.string(), name: v.string() },
  handler: async (ctx, { secret, name }) => {
    checkToolSecret(secret);
    const tool = await ctx.db
      .query("tools")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (tool && !tool.enabled && tool.health !== "unknown") {
      return { allowed: false };
    }
    return { allowed: true };
  },
});

export const reportToolError = mutation({
  args: { secret: v.string(), name: v.string(), message: v.string() },
  handler: async (ctx, { secret, name, message }) => {
    checkToolSecret(secret);
    const tool = await ctx.db
      .query("tools")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (tool) {
      await ctx.db.patch(tool._id, {
        health: "error",
        lastError: message.slice(0, 300),
      });
    }
  },
});

export const captureThought = mutation({
  args: {
    secret: v.string(),
    raw: v.string(),
    cleaned: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, { secret, raw, cleaned, tags }) => {
    checkToolSecret(secret);
    const id = await ctx.db.insert("thoughts", { raw, cleaned, tags });
    await ctx.db.insert("briefingCards", {
      kind: "note",
      title: "Thought captured",
      body: cleaned,
    });
    await markToolHealthy(ctx, "capture_thought");
    return id;
  },
});

export const remember = mutation({
  args: {
    secret: v.string(),
    content: v.string(),
    type: v.union(
      v.literal("preference"),
      v.literal("fact"),
      v.literal("project"),
      v.literal("person"),
    ),
  },
  handler: async (ctx, { secret, content, type }) => {
    checkToolSecret(secret);
    const id = await ctx.db.insert("memories", { content, type });
    await markToolHealthy(ctx, "remember");
    return id;
  },
});

export const recall = query({
  args: {
    secret: v.string(),
    searchQuery: v.string(),
  },
  handler: async (ctx, { secret, searchQuery }) => {
    checkToolSecret(secret);
    const [thoughts, memories] = await Promise.all([
      ctx.db
        .query("thoughts")
        .withSearchIndex("search_cleaned", (q) =>
          q.search("cleaned", searchQuery),
        )
        .take(5),
      ctx.db
        .query("memories")
        .withSearchIndex("search_content", (q) =>
          q.search("content", searchQuery),
        )
        .take(5),
    ]);
    return {
      thoughts: thoughts.map((t) => ({ content: t.cleaned, tags: t.tags })),
      memories: memories.map((m) => ({ content: m.content, type: m.type })),
    };
  },
});

export const markRecallHealthy = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    await markToolHealthy(ctx, "recall");
  },
});

export const pushBriefingCards = mutation({
  args: {
    secret: v.string(),
    tool: v.string(),
    cards: v.array(
      v.object({
        kind: v.union(
          v.literal("calendar"),
          v.literal("email"),
          v.literal("research"),
          v.literal("note"),
        ),
        title: v.string(),
        body: v.string(),
      }),
    ),
  },
  handler: async (ctx, { secret, tool, cards }) => {
    checkToolSecret(secret);
    for (const card of cards) {
      await ctx.db.insert("briefingCards", card);
    }
    await markToolHealthy(ctx, tool);
  },
});

// Standing context injected into the agent prompt at session start: the
// browser fetches this (as Tarik) and passes it as a dynamic variable.
export const standingContext = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const memories = await ctx.db.query("memories").order("desc").take(30);
    if (memories.length === 0) return "No stored memories yet.";
    return memories.map((m) => `- [${m.type}] ${m.content}`).join("\n");
  },
});
