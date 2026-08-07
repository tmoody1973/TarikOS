import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { checkToolSecret, markToolHealthy } from "./secondBrain";
import { voyageEmbed } from "./embeddingsLib";

// Memory consolidation + semantic recall (MOO-484). The Claude call happens
// in the Next tool route (/api/tools/consolidate_memories); these functions
// feed it and apply its output. Embeddings run entirely in Convex actions
// (VOYAGE_API_KEY lives in Convex env only).

const DAY_MS = 24 * 60 * 60 * 1000;
const MEMORY_TYPES = ["preference", "fact", "project", "person"] as const;
const memoryType = v.union(...MEMORY_TYPES.map((t) => v.literal(t)));

// ---- Consolidation ----

export const consolidationInput = query({
  args: { secret: v.string() },
  handler: async (
    ctx,
    { secret },
  ): Promise<{
    transcripts: {
      id: Id<"transcripts">;
      title: string;
      turns: { role: string; text: string }[];
    }[];
    memories: { id: Id<"memories">; content: string; type: string }[];
  }> => {
    checkToolSecret(secret);
    const since = Date.now() - DAY_MS;
    const transcripts = (
      await ctx.db.query("transcripts").order("desc").take(50)
    ).filter((t) => t._creationTime > since && t.turns.length > 0);
    const memories = await ctx.db.query("memories").order("desc").take(200);
    return {
      transcripts: transcripts.map((t) => ({
        id: t._id,
        title: t.title,
        turns: t.turns.map((turn) => ({ role: turn.role, text: turn.text })),
      })),
      memories: memories.map((m) => ({
        id: m._id,
        content: m.content,
        type: m.type,
      })),
    };
  },
});

export const applyConsolidation = internalMutation({
  args: {
    newMemories: v.array(
      v.object({
        content: v.string(),
        type: memoryType,
        transcriptId: v.optional(v.id("transcripts")),
      }),
    ),
    updates: v.array(
      v.object({ id: v.id("memories"), content: v.string() }),
    ),
    deletes: v.array(v.id("memories")),
  },
  handler: async (
    ctx,
    { newMemories, updates, deletes },
  ): Promise<{ added: number; updated: number; deleted: number }> => {
    for (const m of newMemories) {
      await ctx.db.insert("memories", m);
    }
    let updated = 0;
    for (const u of updates) {
      if (await ctx.db.get(u.id)) {
        // Content changed → stale embedding; clear it so backfill re-embeds.
        await ctx.db.patch(u.id, {
          content: u.content,
          updatedAt: Date.now(),
          embedding: undefined,
        });
        updated++;
      }
    }
    let deleted = 0;
    for (const id of deletes) {
      if (await ctx.db.get(id)) {
        await ctx.db.delete(id);
        deleted++;
      }
    }
    await markToolHealthy(ctx, "consolidate_memories");
    await ctx.scheduler.runAfter(0, internal.memoryOps.backfillEmbeddings, {});
    return { added: newMemories.length, updated, deleted };
  },
});

// Public wrapper for the tool route (secret-gated).
export const applyConsolidationFromTool = action({
  args: {
    secret: v.string(),
    newMemories: v.array(
      v.object({
        content: v.string(),
        type: memoryType,
        transcriptId: v.optional(v.id("transcripts")),
      }),
    ),
    updates: v.array(
      v.object({ id: v.id("memories"), content: v.string() }),
    ),
    deletes: v.array(v.id("memories")),
  },
  handler: async (
    ctx,
    { secret, ...ops },
  ): Promise<{ added: number; updated: number; deleted: number }> => {
    checkToolSecret(secret);
    return await ctx.runMutation(internal.memoryOps.applyConsolidation, ops);
  },
});

// ---- Embeddings backfill (new rows + historical rows, same path) ----

export const unembedded = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    memories: { id: Id<"memories">; text: string }[];
    thoughts: { id: Id<"thoughts">; text: string }[];
    telos: { id: Id<"telosItems">; text: string }[];
  }> => {
    const memories = await ctx.db
      .query("memories")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .take(64);
    const thoughts = await ctx.db
      .query("thoughts")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .take(64);
    const telos = await ctx.db
      .query("telosItems")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .take(64);
    return {
      memories: memories.map((m) => ({ id: m._id, text: m.content })),
      thoughts: thoughts.map((t) => ({ id: t._id, text: t.cleaned })),
      telos: telos.map((t) => ({ id: t._id, text: t.text })),
    };
  },
});

export const storeEmbeddings = internalMutation({
  args: {
    memories: v.array(
      v.object({ id: v.id("memories"), embedding: v.array(v.float64()) }),
    ),
    thoughts: v.array(
      v.object({ id: v.id("thoughts"), embedding: v.array(v.float64()) }),
    ),
    telos: v.array(
      v.object({ id: v.id("telosItems"), embedding: v.array(v.float64()) }),
    ),
  },
  handler: async (ctx, { memories, thoughts, telos }): Promise<void> => {
    await Promise.all([
      ...memories.map(async (m) => {
        if (await ctx.db.get(m.id)) await ctx.db.patch(m.id, { embedding: m.embedding });
      }),
      ...thoughts.map(async (t) => {
        if (await ctx.db.get(t.id)) await ctx.db.patch(t.id, { embedding: t.embedding });
      }),
      ...telos.map(async (t) => {
        if (await ctx.db.get(t.id)) await ctx.db.patch(t.id, { embedding: t.embedding });
      }),
    ]);
  },
});

export const backfillEmbeddings = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      console.log("VOYAGE_API_KEY not set; skipping embedding backfill");
      return "skipped: no key";
    }
    let total = 0;
    // Bounded loop; each pass embeds up to 128 rows.
    for (let pass = 0; pass < 10; pass++) {
      const batch = await ctx.runQuery(internal.memoryOps.unembedded, {});
      const texts = [
        ...batch.memories.map((m) => m.text),
        ...batch.thoughts.map((t) => t.text),
        ...batch.telos.map((t) => t.text),
      ];
      if (texts.length === 0) break;
      const vectors = await voyageEmbed(apiKey, texts, "document");
      const thoughtBase = batch.memories.length;
      const telosBase = thoughtBase + batch.thoughts.length;
      await ctx.runMutation(internal.memoryOps.storeEmbeddings, {
        memories: batch.memories.map((m, i) => ({
          id: m.id,
          embedding: vectors[i],
        })),
        thoughts: batch.thoughts.map((t, i) => ({
          id: t.id,
          embedding: vectors[thoughtBase + i],
        })),
        telos: batch.telos.map((t, i) => ({
          id: t.id,
          embedding: vectors[telosBase + i],
        })),
      });
      total += texts.length;
    }
    return `embedded ${total} row(s)`;
  },
});

// ---- Hybrid recall (vector + text) ----

const MIN_SCORE = 0.4; // ponytail: single similarity floor; tune if noisy

export const getMemoriesByIds = internalQuery({
  args: { ids: v.array(v.id("memories")) },
  handler: async (ctx, { ids }): Promise<Doc<"memories">[]> => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs.filter((d): d is Doc<"memories"> => d !== null);
  },
});

export const getThoughtsByIds = internalQuery({
  args: { ids: v.array(v.id("thoughts")) },
  handler: async (ctx, { ids }): Promise<Doc<"thoughts">[]> => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs.filter((d): d is Doc<"thoughts"> => d !== null);
  },
});

export const getTelosByIds = internalQuery({
  args: { ids: v.array(v.id("telosItems")) },
  handler: async (ctx, { ids }): Promise<Doc<"telosItems">[]> => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs.filter((d): d is Doc<"telosItems"> => d !== null);
  },
});

// Shared: embed the query and fetch the vector-matched docs (null = no key).
async function vectorHits(
  ctx: ActionCtx,
  searchQuery: string,
): Promise<{
  memDocs: Doc<"memories">[];
  thoughtDocs: Doc<"thoughts">[];
  telosDocs: Doc<"telosItems">[];
} | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return null;
  const [vector] = await voyageEmbed(apiKey, [searchQuery], "query");
  const [memHits, thoughtHits, telosHits] = await Promise.all([
    ctx.vectorSearch("memories", "by_embedding", { vector, limit: 5 }),
    ctx.vectorSearch("thoughts", "by_embedding", { vector, limit: 5 }),
    ctx.vectorSearch("telosItems", "by_embedding", { vector, limit: 5 }),
  ]);
  const [memDocs, thoughtDocs, telosDocs] = await Promise.all([
    ctx.runQuery(internal.memoryOps.getMemoriesByIds, {
      ids: memHits.filter((h) => h._score >= MIN_SCORE).map((h) => h._id),
    }),
    ctx.runQuery(internal.memoryOps.getThoughtsByIds, {
      ids: thoughtHits.filter((h) => h._score >= MIN_SCORE).map((h) => h._id),
    }),
    ctx.runQuery(internal.memoryOps.getTelosByIds, {
      ids: telosHits.filter((h) => h._score >= MIN_SCORE).map((h) => h._id),
    }),
  ]);
  return { memDocs, thoughtDocs, telosDocs };
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) =>
    seen.has(key(i)) ? false : (seen.add(key(i)), true),
  );
}

// Voice tool path (secret-gated) — the recall route calls this. Returns the
// same compact shape the agent already knows from the text-only recall.
export const hybridRecall = action({
  args: { secret: v.string(), searchQuery: v.string() },
  handler: async (
    ctx,
    { secret, searchQuery },
  ): Promise<{
    memories: { content: string; type: string }[];
    thoughts: { content: string; tags: string[] }[];
    semantic: boolean;
  }> => {
    checkToolSecret(secret);
    const text = await ctx.runQuery(api.secondBrain.recall, {
      secret,
      searchQuery,
    });
    const vec = await vectorHits(ctx, searchQuery);
    if (!vec) return { ...text, semantic: false };
    return {
      memories: dedupeBy(
        [
          ...vec.memDocs.map((m) => ({ content: m.content, type: m.type })),
          // Telos hits ride along as memory-shaped rows so the agent's known
          // recall shape is unchanged (type = goal/problem/…).
          ...vec.telosDocs
            .filter((t) => t.status === "active")
            .map((t) => ({ content: t.text, type: t.kind })),
          ...text.memories,
        ],
        (m) => m.content,
      ).slice(0, 6),
      thoughts: dedupeBy(
        [
          ...vec.thoughtDocs.map((t) => ({ content: t.cleaned, tags: t.tags })),
          ...text.thoughts,
        ],
        (t) => t.content,
      ).slice(0, 6),
      semantic: true,
    };
  },
});

// Dashboard path (identity-gated). Returns full docs so the HUD keeps its shape.
export const dashboardSearch = action({
  args: { searchQuery: v.string() },
  handler: async (
    ctx,
    { searchQuery },
  ): Promise<{ thoughts: Doc<"thoughts">[]; memories: Doc<"memories">[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const text = await ctx.runQuery(api.transcripts.searchSecondBrain, {
      searchQuery,
    });
    const vec = await vectorHits(ctx, searchQuery);
    if (!vec) return text;
    return {
      memories: dedupeBy([...vec.memDocs, ...text.memories], (m) => m._id).slice(0, 10),
      thoughts: dedupeBy([...vec.thoughtDocs, ...text.thoughts], (t) => t._id).slice(0, 10),
    };
  },
});
