import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./dashboard";
import { rankSources, sourceLabel, type SourceHit } from "./studioLib.ts";

// The source picker and the reference store (Studio Phase 2).
//
// Separate file from studio.ts because it reaches across six unrelated tables
// and studio.ts is already the persistence layer for one.
//
// References, never copies. A reference stores a type and the record's own id,
// so a brief written in March still knows where it came from after the
// conversation behind it is gone — and nothing here can be edited into
// disagreeing with the record it points at, because it holds no content.

const sourceType = v.union(
  v.literal("brief"),
  v.literal("conversation"),
  v.literal("telos"),
  v.literal("contact"),
  v.literal("thought"),
  v.literal("document"),
  v.literal("url"),
);

/**
 * How many rows each table contributes before ranking.
 *
 * Bounded per table rather than overall: an unbounded scan of transcripts
 * would make the picker's first keystroke the slowest thing on the system, and
 * taking a global limit would let one chatty table crowd out the other five
 * entirely.
 */
const PER_TABLE = 200;

/** First N characters of a body, for matching and for the picker's preview. */
const SNIPPET = 240;

function snippet(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, SNIPPET);
}

/**
 * Everything referenceable that matches, best first.
 *
 * Reads six tables and ranks them together, so the answer is "what did I mean"
 * rather than "which table did I look in first".
 */
export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { query: text, limit }) => {
    await requireUser(ctx);
    if (!text.trim()) return [];

    const hits: SourceHit[] = [];

    const briefs = await ctx.db.query("briefs").order("desc").take(PER_TABLE);
    for (const b of briefs) {
      hits.push({
        type: "brief",
        sourceId: b._id,
        title: b.title,
        snippet: snippet(b.sections.map((s) => `${s.heading} ${s.body}`).join(" ")),
        at: b.runStartedAt,
      });
    }

    const thoughts = await ctx.db.query("thoughts").order("desc").take(PER_TABLE);
    for (const t of thoughts) {
      hits.push({
        type: "thought",
        sourceId: t._id,
        // A thought has no title. Its own first words are the closest thing,
        // and sourceLabel names it by kind when even those are empty.
        title: snippet(t.cleaned ?? t.raw ?? "").slice(0, 80),
        snippet: snippet(t.cleaned ?? t.raw ?? ""),
        at: t._creationTime,
      });
    }

    const telos = await ctx.db.query("telosItems").take(PER_TABLE);
    for (const item of telos) {
      hits.push({
        type: "telos",
        sourceId: item._id,
        // A telos item's `text` IS its title — there is no separate one.
        title: item.text,
        snippet: snippet(
          [item.measurable, item.currentState, item.idealState].filter(Boolean).join(" "),
        ),
        at: item.reviewedAt,
      });
    }

    const contacts = await ctx.db.query("contacts").take(PER_TABLE);
    for (const c of contacts) {
      hits.push({
        type: "contact",
        sourceId: c._id,
        title: c.name,
        snippet: snippet([c.org, ...c.emails].filter(Boolean).join(" ")),
        at: c.syncedAt,
      });
    }

    const docs = await ctx.db.query("documents").order("desc").take(PER_TABLE);
    for (const d of docs) {
      hits.push({
        type: "document",
        sourceId: d._id,
        title: d.title,
        snippet: snippet(d.filename),
        at: d.createdAt,
      });
    }

    const transcripts = await ctx.db.query("transcripts").order("desc").take(PER_TABLE);
    for (const t of transcripts) {
      hits.push({
        type: "conversation",
        sourceId: t._id,
        title: t.title,
        // The words actually said, both sides, so searching for what was
        // discussed finds the conversation rather than only its title.
        snippet: snippet(t.turns.map((turn) => turn.text).join(" ")),
        at: t._creationTime,
      });
    }

    return rankSources(hits, text)
      .slice(0, limit ?? 20)
      .map((h) => ({ ...h, label: sourceLabel(h) }));
  },
});

/** What one document points at. */
export const references = query({
  args: { docId: v.id("studioDocs") },
  handler: async (ctx, { docId }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("studioRefs")
      .withIndex("by_doc", (q) => q.eq("docId", docId))
      .collect();
  },
});

/**
 * Point a document at a record.
 *
 * Refuses a duplicate rather than stacking two chips for the same source: the
 * Sources panel is a list of what grounds this document, and the same record
 * twice says nothing extra while making the list harder to read.
 */
export const addReference = mutation({
  args: {
    docId: v.id("studioDocs"),
    sourceType,
    sourceId: v.string(),
    label: v.string(),
  },
  handler: async (ctx, { docId, sourceType: type, sourceId, label }) => {
    await requireUser(ctx);
    const existing = await ctx.db
      .query("studioRefs")
      .withIndex("by_doc", (q) => q.eq("docId", docId))
      .collect();
    const already = existing.find((r) => r.sourceType === type && r.sourceId === sourceId);
    if (already) return { ok: true as const, id: already._id, duplicate: true as const };

    const id = await ctx.db.insert("studioRefs", {
      docId,
      sourceType: type,
      sourceId,
      label: sourceLabel({ type, title: label }),
      createdAt: Date.now(),
    });
    return { ok: true as const, id, duplicate: false as const };
  },
});

/** Stop pointing at a record. The record itself is never touched. */
export const removeReference = mutation({
  args: { id: v.id("studioRefs") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.delete(id);
    return { ok: true as const };
  },
});
