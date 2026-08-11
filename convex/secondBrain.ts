import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { compileTelosSummary } from "./telosLib";
import { rankSources, studioHit } from "./studioLib.ts";

/** How many Studio documents recall ranks. See the note inside `recall`. */
const STUDIO_SCAN = 200;

/** How much of a matched document Zola reads back. */
const STUDIO_EXCERPT = 220;

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
    const [thoughts, memories, studioDocs] = await Promise.all([
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
      // No search index here, deliberately. Studio is ranked with rankSources —
      // the SAME rule the source picker uses — so the brain and the picker
      // cannot disagree about which document Tarik meant. A Convex search index
      // would need a stored plain-text column beside the JSON tree, and a second
      // copy of a document's words inside its own row is exactly the drift this
      // project rejected twice: once when Studio linked to briefs rather than
      // owning them, and once when exports went into `documents`.
      //
      // Affordable because the table is bounded by how fast one person writes.
      // If Studio ever holds thousands, this is the line that changes.
      ctx.db.query("studioDocs").withIndex("by_updated").order("desc").take(STUDIO_SCAN),
    ]);

    // Archived first, then ranked. Filtering afterwards would let something
    // that was put away take one of the five slots the answer has room for.
    const studio = rankSources(
      studioDocs.filter((d) => !d.archivedAt).map(studioHit),
      searchQuery,
    ).slice(0, 5);

    return {
      thoughts: thoughts.map((t) => ({ content: t.cleaned, tags: t.tags })),
      memories: memories.map((m) => ({ content: m.content, type: m.type })),
      // An excerpt, never the document. Zola speaks this aloud, and a whole
      // plan read into a phone call is not an answer — the hit already carries
      // the opening of the writing, which is what a person needs to say "yes,
      // that one".
      studio: studio.map((s) => ({
        id: s.sourceId,
        title: s.title,
        excerpt: s.snippet.slice(0, STUDIO_EXCERPT),
      })),
    };
  },
});

// Generic health-mark for query-shaped tools (queries can't write; their
// routes call this after a successful read). Secret is the trust boundary.
export const markToolHealthyFromTool = mutation({
  args: { secret: v.string(), name: v.string() },
  handler: async (ctx, { secret, name }) => {
    checkToolSecret(secret);
    await markToolHealthy(ctx, name);
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
        url: v.optional(v.string()),
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
// Telos summary (mission/goals/problems) leads; recent memories follow.
export const standingContext = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const [telosItems, memories] = await Promise.all([
      ctx.db.query("telosItems").take(200),
      ctx.db.query("memories").order("desc").take(30),
    ]);
    const telos = compileTelosSummary(telosItems, Date.now());
    const memoryBlock =
      memories.length === 0
        ? "No stored memories yet."
        : memories.map((m) => `- [${m.type}] ${m.content}`).join("\n");
    return telos
      ? `Tarik's telos — his mission, goals, and problems. Let it steer priorities and suggestions:\n${telos}\n\nRecent memories:\n${memoryBlock}`
      : memoryBlock;
  },
});
