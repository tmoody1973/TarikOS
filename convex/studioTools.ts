import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret, markToolHealthy } from "./secondBrain";
import {
  blocksMatching,
  documentFrom,
  deriveTitle,
  excerpt,
  parseValue,
  plainText,
  rankSources,
  studioHit,
} from "./studioLib.ts";

// Studio, as Zola reaches it.
//
// A separate file from studio.ts for one reason: everything there is gated by
// `requireUser`, a Clerk session belonging to a browser. Zola has no session —
// she is a webhook holding a shared secret. Relaxing the guard on the browser
// functions would open the whole writing workspace to anything that can reach
// the URL, so the voice path gets its own, narrower surface instead.
//
// Narrower on purpose. She can find, read, create — and PROPOSE. She cannot
// apply, archive, delete, rename or restore. Voice cannot show a diff, so voice
// must not write into a document he is already holding.

/** How many documents she ranks. Bounded by how fast one person writes. */
const SCAN = 200;

/** Enough of a document to say "yes, that one" without reading it aloud. */
const EXCERPT = 200;

const docType = v.union(
  v.literal("note"),
  v.literal("draft"),
  v.literal("brief"),
  v.literal("plan"),
  v.literal("decision"),
);

/**
 * The documents that could be the one he means, best first.
 *
 * Ranked with `rankSources` — the same rule the source picker and `recall` use.
 * Three surfaces, one answer to "which document did he mean".
 */
export const search = query({
  args: { secret: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, query: text, limit }) => {
    checkToolSecret(secret);
    if (!text.trim()) return [];
    const rows = await ctx.db
      .query("studioDocs")
      .withIndex("by_updated")
      .order("desc")
      .take(SCAN);
    const live = rows.filter((d) => !d.archivedAt);
    const byId = new Map(live.map((d) => [d._id as string, d]));
    return rankSources(live.map(studioHit), text)
      .slice(0, limit ?? 5)
      .map((hit) => {
        const doc = byId.get(hit.sourceId)!;
        return {
          id: doc._id,
          title: doc.title || `Untitled ${doc.docType}`,
          docType: doc.docType,
          excerpt: excerpt(parseValue(doc.content), EXCERPT),
          updatedAt: doc.updatedAt,
        };
      });
  },
});

/**
 * One document as words.
 *
 * Plain text, never the stored tree. The tree is the editor's business; handed
 * to a speech model it is noise she can only mangle, and she would read the
 * word "children" aloud.
 */
export const read = query({
  args: { secret: v.string(), id: v.id("studioDocs"), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, id, limit }) => {
    checkToolSecret(secret);
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    const text = plainText(parseValue(doc.content));
    return {
      id: doc._id,
      title: doc.title || `Untitled ${doc.docType}`,
      docType: doc.docType,
      revision: doc.revision,
      truncated: limit !== undefined && text.length > limit,
      text: limit === undefined ? text : text.slice(0, limit),
    };
  },
});

/**
 * The blocks a quote could mean, plus everything a proposal needs to be
 * grounded — in ONE call, because the alternative is three round trips from a
 * route that is already inside a phone call.
 *
 * Returns EVERY candidate. Nothing here picks between two, and nothing
 * downstream may either: two paragraphs matching is a question for Tarik.
 */
export const blocks = query({
  args: { secret: v.string(), id: v.id("studioDocs"), quote: v.string() },
  handler: async (ctx, { secret, id, quote }) => {
    checkToolSecret(secret);
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    const refs = await ctx.db
      .query("studioRefs")
      .withIndex("by_doc", (q) => q.eq("docId", id))
      .collect();
    return {
      title: doc.title || `Untitled ${doc.docType}`,
      docType: doc.docType,
      revision: doc.revision,
      matches: blocksMatching(parseValue(doc.content), quote),
      references: refs.map((r) => ({ sourceType: r.sourceType, label: r.label })),
    };
  },
});

/** A new document from dictation, shaped by its type's template. */
export const create = mutation({
  args: {
    secret: v.string(),
    docType,
    title: v.optional(v.string()),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { secret, docType: type, title, text }) => {
    checkToolSecret(secret);
    const value = documentFrom(type, title ?? "", text ?? "");
    const now = Date.now();
    const id = await ctx.db.insert("studioDocs", {
      // Same rule as the editor's: an explicit title wins, otherwise the first
      // block with words in it names the document.
      title: (title ?? "").trim() || deriveTitle(value),
      docType: type,
      content: JSON.stringify(value),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    await markToolHealthy(ctx, "write_studio_document");
    return { id, title: (title ?? "").trim() || deriveTitle(value) || `Untitled ${type}` };
  },
});

/**
 * A rewrite, waiting.
 *
 * The document is NOT touched. That is the whole design: voice cannot show a
 * diff, so voice does not write. The proposal appears in the open document
 * while she is still talking, because Convex is realtime — and if the document
 * is closed it waits, and the index shows a count.
 *
 * `original` is stored because by the time this is accepted the paragraph may
 * have been rewritten by hand. Without it, accepting silently deletes that
 * rewrite.
 */
export const propose = mutation({
  args: {
    secret: v.string(),
    docId: v.id("studioDocs"),
    blockIndex: v.number(),
    original: v.string(),
    proposed: v.string(),
    instruction: v.string(),
  },
  handler: async (ctx, args) => {
    checkToolSecret(args.secret);
    const doc = await ctx.db.get(args.docId);
    if (!doc) return { ok: false as const, reason: "missing" as const };
    const id = await ctx.db.insert("studioProposals", {
      docId: args.docId,
      blockIndex: args.blockIndex,
      original: args.original,
      proposed: args.proposed,
      instruction: args.instruction,
      origin: "voice",
      status: "pending",
      createdAt: Date.now(),
    });
    await markToolHealthy(ctx, "propose_studio_edit");
    return { ok: true as const, id, title: doc.title || `Untitled ${doc.docType}` };
  },
});
