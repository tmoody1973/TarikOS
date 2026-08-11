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
import { excerpt, parseValue, plainText } from "./studioLib.ts";

// Memory consolidation + semantic recall (MOO-484). The Claude call happens
// in the Next tool route (/api/tools/consolidate_memories); these functions
// feed it and apply its output. Embeddings run entirely in Convex actions
// (VOYAGE_API_KEY lives in Convex env only).

const DAY_MS = 24 * 60 * 60 * 1000;

/** How much of a matched Studio document Zola reads back. */
const STUDIO_EXCERPT = 220;

/**
 * How much of a document is embedded.
 *
 * Voyage takes a bounded input and a plan can run to thousands of words. The
 * opening carries the subject, which is what a "what was I writing about X"
 * question is actually asking. Chunking a document into several vectors is the
 * real answer and is not what today needs.
 */
const EMBED_CHARS = 8000;
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
    journal: { id: Id<"journalEntries">; text: string; mode: string }[];
    telosItems: { id: Id<"telosItems">; kind: string; text: string; status: string }[];
  }> => {
    checkToolSecret(secret);
    const since = Date.now() - DAY_MS;
    const transcripts = (
      await ctx.db.query("transcripts").order("desc").take(50)
    ).filter((t) => t._creationTime > since && t.turns.length > 0);
    const memories = await ctx.db.query("memories").order("desc").take(200);
    // ponytail: unconsolidated older than the newest 100 goes invisible;
    // add an index if journaling volume ever makes that real.
    const journal = (await ctx.db.query("journalEntries").order("desc").take(100)).filter(
      (j) => j.consolidatedAt === undefined,
    );
    const telosItems = (await ctx.db.query("telosItems").take(200)).filter(
      (t) => t.status === "active",
    );
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
      journal: journal.map((j) => ({ id: j._id, text: j.text, mode: j.mode })),
      telosItems: telosItems.map((t) => ({
        id: t._id,
        kind: t.kind,
        text: t.text,
        status: t.status,
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
    telosUpdates: v.array(
      v.object({
        id: v.id("telosItems"),
        text: v.optional(v.string()),
        status: v.optional(
          v.union(
            v.literal("active"),
            v.literal("deferred"),
            v.literal("done"),
            v.literal("dropped"),
          ),
        ),
        measurable: v.optional(v.string()),
        transcriptId: v.optional(v.id("transcripts")),
      }),
    ),
    journalIds: v.array(v.id("journalEntries")),
  },
  handler: async (
    ctx,
    { secret, telosUpdates, journalIds, ...ops },
  ): Promise<{
    added: number;
    updated: number;
    deleted: number;
    telosApplied: number;
  }> => {
    checkToolSecret(secret);
    const result = await ctx.runMutation(internal.memoryOps.applyConsolidation, ops);
    // Telos pass is isolated: its failure never sinks the memory pass, and it
    // reports itself to the control panel. Journal entries stay unstamped on
    // failure so tomorrow's run retries them (memory dedupe absorbs repeats).
    let telosApplied = 0;
    try {
      telosApplied = await ctx.runMutation(
        internal.telos.applyConsolidationUpdates,
        { updates: telosUpdates },
      );
      await ctx.runMutation(internal.journal.stampConsolidated, { ids: journalIds });
    } catch (err) {
      await ctx
        .runMutation(api.secondBrain.reportToolError, {
          secret,
          name: "consolidate_memories",
          message: `telos pass failed: ${err instanceof Error ? err.message : String(err)}`,
        })
        .catch(() => {});
    }
    return { ...result, telosApplied };
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
    journal: { id: Id<"journalEntries">; text: string }[];
    studio: { id: Id<"studioDocs">; text: string; revision: number }[];
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
    const journal = await ctx.db
      .query("journalEntries")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .take(64);
    // Studio is the one kind whose staleness is a COMPARISON rather than an
    // absence. The other four clear their embedding when their text changes, so
    // "no embedding" means "due". A Studio document is edited for weeks and
    // always has an embedding — of some earlier revision. So the counter it was
    // embedded from is stored, and a row is due when that counter is behind.
    //
    // Collected rather than taken: the take has to happen AFTER the comparison,
    // or 64 already-embedded documents fill the batch and the stale one never
    // gets a turn. Affordable because the table is bounded by how fast one
    // person writes — the same reason recall scans it.
    const studioAll = await ctx.db.query("studioDocs").collect();
    const studio = studioAll
      .filter((d) => !d.archivedAt && d.embeddedRevision !== d.revision)
      .slice(0, 64);
    return {
      memories: memories.map((m) => ({ id: m._id, text: m.content })),
      thoughts: thoughts.map((t) => ({ id: t._id, text: t.cleaned })),
      telos: telos.map((t) => ({ id: t._id, text: t.text })),
      journal: journal.map((j) => ({ id: j._id, text: j.text })),
      studio: studio.map((d) => ({
        id: d._id,
        // The writing, not the tree it is stored in. Embedding the stored
        // string would embed "children" and "type" once per block, and every
        // document would sit near every other document.
        text: `${d.title}\n${plainText(parseValue(d.content))}`.slice(0, EMBED_CHARS),
        // Captured with the text, not read again later: by the time the vector
        // comes back the document may have moved on, and stamping it with the
        // newer number would mark work as done that was never done.
        revision: d.revision,
      })),
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
    journal: v.array(
      v.object({ id: v.id("journalEntries"), embedding: v.array(v.float64()) }),
    ),
    studio: v.array(
      v.object({
        id: v.id("studioDocs"),
        embedding: v.array(v.float64()),
        revision: v.number(),
      }),
    ),
  },
  handler: async (ctx, { memories, thoughts, telos, journal, studio }): Promise<void> => {
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
      ...journal.map(async (j) => {
        if (await ctx.db.get(j.id)) await ctx.db.patch(j.id, { embedding: j.embedding });
      }),
      // The vector and the counter move together, always. Patching the vector
      // alone leaves the row due forever — the backfill would re-embed the same
      // document on every pass, every night, at Voyage's expense.
      ...studio.map(async (s) => {
        if (await ctx.db.get(s.id)) {
          await ctx.db.patch(s.id, {
            embedding: s.embedding,
            embeddedRevision: s.revision,
          });
        }
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
        ...batch.journal.map((j) => j.text),
        ...batch.studio.map((s) => s.text),
      ];
      if (texts.length === 0) break;
      const vectors = await voyageEmbed(apiKey, texts, "document");
      const thoughtBase = batch.memories.length;
      const telosBase = thoughtBase + batch.thoughts.length;
      const journalBase = telosBase + batch.telos.length;
      const studioBase = journalBase + batch.journal.length;
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
        journal: batch.journal.map((j, i) => ({
          id: j.id,
          embedding: vectors[journalBase + i],
        })),
        studio: batch.studio.map((s, i) => ({
          id: s.id,
          embedding: vectors[studioBase + i],
          revision: s.revision,
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

export const getJournalByIds = internalQuery({
  args: { ids: v.array(v.id("journalEntries")) },
  handler: async (ctx, { ids }): Promise<Doc<"journalEntries">[]> => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs.filter((d): d is Doc<"journalEntries"> => d !== null);
  },
});

export const getStudioByIds = internalQuery({
  args: { ids: v.array(v.id("studioDocs")) },
  handler: async (ctx, { ids }): Promise<Doc<"studioDocs">[]> => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    // Archived documents are dropped here rather than at the vector search,
    // which cannot filter on a field it was not built with. A document put away
    // should not come back because it is semantically close to the question.
    return docs.filter((d): d is Doc<"studioDocs"> => d !== null && !d.archivedAt);
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
  journalDocs: Doc<"journalEntries">[];
  studioDocs: Doc<"studioDocs">[];
} | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return null;
  const [vector] = await voyageEmbed(apiKey, [searchQuery], "query");
  const [memHits, thoughtHits, telosHits, journalHits, studioHits] = await Promise.all([
    ctx.vectorSearch("memories", "by_embedding", { vector, limit: 5 }),
    ctx.vectorSearch("thoughts", "by_embedding", { vector, limit: 5 }),
    ctx.vectorSearch("telosItems", "by_embedding", { vector, limit: 5 }),
    ctx.vectorSearch("journalEntries", "by_embedding", { vector, limit: 5 }),
    ctx.vectorSearch("studioDocs", "by_embedding", { vector, limit: 5 }),
  ]);
  const [memDocs, thoughtDocs, telosDocs, journalDocs, studioDocs] = await Promise.all([
    ctx.runQuery(internal.memoryOps.getMemoriesByIds, {
      ids: memHits.filter((h) => h._score >= MIN_SCORE).map((h) => h._id),
    }),
    ctx.runQuery(internal.memoryOps.getThoughtsByIds, {
      ids: thoughtHits.filter((h) => h._score >= MIN_SCORE).map((h) => h._id),
    }),
    ctx.runQuery(internal.memoryOps.getTelosByIds, {
      ids: telosHits.filter((h) => h._score >= MIN_SCORE).map((h) => h._id),
    }),
    ctx.runQuery(internal.memoryOps.getJournalByIds, {
      ids: journalHits.filter((h) => h._score >= MIN_SCORE).map((h) => h._id),
    }),
    ctx.runQuery(internal.memoryOps.getStudioByIds, {
      ids: studioHits.filter((h) => h._score >= MIN_SCORE).map((h) => h._id),
    }),
  ]);
  return { memDocs, thoughtDocs, telosDocs, journalDocs, studioDocs };
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
    studio: { id: string; title: string; excerpt: string }[];
    semantic: boolean;
  }> => {
    checkToolSecret(secret);
    const [text, vec] = await Promise.all([
      ctx.runQuery(api.secondBrain.recall, { secret, searchQuery }),
      vectorHits(ctx, searchQuery),
    ]);
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
          // Journal hits ride along thought-shaped, tagged for the agent.
          ...vec.journalDocs.map((j) => ({ content: j.text, tags: ["journal", j.mode] })),
          ...text.thoughts,
        ],
        (t) => t.content,
      ).slice(0, 6),
      // Studio stays its own kind rather than riding along as a thought. A
      // thought is a captured idea; a Studio document is a thing Tarik is
      // writing, and the answer "it's in your plan" is different from "you had
      // a thought about that". The id travels so the next tool can open it.
      studio: dedupeBy(
        [
          ...vec.studioDocs.map((d) => ({
            id: d._id as string,
            title: d.title,
            excerpt: excerpt(parseValue(d.content), STUDIO_EXCERPT),
          })),
          ...text.studio,
        ],
        (s) => s.id,
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
  ): Promise<{
    thoughts: Doc<"thoughts">[];
    memories: Doc<"memories">[];
    journal: Doc<"journalEntries">[];
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const [text, vec] = await Promise.all([
      ctx.runQuery(api.transcripts.searchSecondBrain, { searchQuery }),
      vectorHits(ctx, searchQuery),
    ]);
    if (!vec) return { ...text, journal: [] };
    return {
      memories: dedupeBy([...vec.memDocs, ...text.memories], (m) => m._id).slice(0, 10),
      thoughts: dedupeBy([...vec.thoughtDocs, ...text.thoughts], (t) => t._id).slice(0, 10),
      journal: vec.journalDocs,
    };
  },
});
