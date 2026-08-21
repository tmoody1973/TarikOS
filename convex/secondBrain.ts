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

// ------------------------------------------------------------ second brain v1
//
// Two verbs for decisions and open loops. Both follow the same rule the older
// capture verbs follow: they take what the sentence contained and nothing else.
// If Tarik did not name a person or a date, the record simply does not have
// one. Asking is the regression.

export const recordDecision = mutation({
  args: {
    secret: v.string(),
    what: v.string(),
    why: v.string(),
    supersedes: v.optional(v.id("decisions")),
    transcriptId: v.optional(v.id("transcripts")),
  },
  handler: async (ctx, { secret, what, why, supersedes, transcriptId }) => {
    checkToolSecret(secret);
    const id = await ctx.db.insert("decisions", {
      what,
      why,
      decidedAt: Date.now(),
      supersedes,
      transcriptId,
    });
    await ctx.db.insert("briefingCards", {
      kind: "note",
      title: "Decision recorded",
      body: what,
    });
    await markToolHealthy(ctx, "record_decision");
    return id;
  },
});

export const openLoop = mutation({
  args: {
    secret: v.string(),
    text: v.string(),
    person: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    transcriptId: v.optional(v.id("transcripts")),
  },
  handler: async (ctx, { secret, text, person, dueAt, transcriptId }) => {
    checkToolSecret(secret);
    const id = await ctx.db.insert("openLoops", {
      text,
      status: "open",
      person,
      dueAt,
      openedAt: Date.now(),
      transcriptId,
    });
    await markToolHealthy(ctx, "open_loop");
    return id;
  },
});

// Closing is by fuzzy text, because he will not be holding an id in his head.
// Two candidates is a question, never a guess — the same never-pick-between-
// two-matches rule the rest of the tool surface follows.
export const closeLoop = mutation({
  args: { secret: v.string(), text: v.string() },
  handler: async (ctx, { secret, text }) => {
    checkToolSecret(secret);
    const open = await ctx.db
      .query("openLoops")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    const matches = matchLoops(open, text);
    if (matches.length === 0) return { outcome: "none" as const, candidates: [] };
    if (matches.length > 1) {
      return {
        outcome: "ambiguous" as const,
        candidates: matches.slice(0, 3).map((l) => l.text),
      };
    }
    await ctx.db.patch(matches[0]._id, {
      status: "closed",
      closedAt: Date.now(),
    });
    await markToolHealthy(ctx, "close_loop");
    return { outcome: "closed" as const, candidates: [matches[0].text] };
  },
});

// Word-overlap match. Deliberately not an embedding call: closing a loop is a
// three-word utterance against a list that is tens of rows long, and a network
// hop in the voice path costs more than the precision buys.
export function matchLoops<T extends { text: string }>(loops: T[], query: string): T[] {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2),
    );
  const q = words(query);
  if (q.size === 0) return [];
  const scored = loops
    .map((l) => {
      const t = words(l.text);
      let hit = 0;
      for (const w of q) if (t.has(w)) hit++;
      return { l, score: hit / q.size };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];
  // A clear winner is one match; a tie is an ambiguity he gets asked about.
  const top = scored[0].score;
  return scored.filter((s) => s.score === top).map((s) => s.l);
}

export const recentDecisions = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    return await ctx.db.query("decisions").withIndex("by_decidedAt").order("desc").take(50);
  },
});

export const openLoopsList = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    return await ctx.db
      .query("openLoops")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
  },
});
