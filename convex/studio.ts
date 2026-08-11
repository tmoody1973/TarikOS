import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./dashboard";
import { deriveTitle, excerpt, templateFor, type StudioValue } from "./studioLib.ts";

// Studio persistence.
//
// Clerk-gated throughout, not secret-gated: every caller here is a browser page
// with a session, unlike the tool routes Zola calls.
//
// The one rule that shapes all of it: a write carries the revision it was
// written from, and a write whose revision no longer matches is refused. See
// `save` for why that is not optional.

const docType = v.union(
  v.literal("note"),
  v.literal("draft"),
  v.literal("brief"),
  v.literal("plan"),
  v.literal("decision"),
);

/** How much of a document the index preview carries. */
const EXCERPT_CHARS = 160;

/**
 * Convex documents cap at 1MB and a version snapshot doubles the cost of a
 * save. Refused rather than truncated: silently dropping the end of someone's
 * writing is worse than telling them the document is too big.
 */
const MAX_CONTENT_BYTES = 400_000;

/** The stored tree, or an empty document if it cannot be read. */
function parse(content: string): StudioValue {
  try {
    const value = JSON.parse(content);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * The document index.
 *
 * Sends a title and a preview, never the bodies. Shipping 200 whole documents
 * to render a list makes the first screen the slowest one.
 */
export const list = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { includeArchived }) => {
    await requireUser(ctx);
    const all = await ctx.db.query("studioDocs").withIndex("by_updated").order("desc").collect();
    const rows = includeArchived ? all : all.filter((d) => !d.archivedAt);
    return rows.map((d) => ({
      _id: d._id,
      title: d.title,
      docType: d.docType,
      excerpt: excerpt(parse(d.content), EXCERPT_CHARS),
      updatedAt: d.updatedAt,
      archivedAt: d.archivedAt,
    }));
  },
});

/** One document, whole. The editor is the only thing that needs the body. */
export const get = query({
  args: { id: v.id("studioDocs") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    return {
      _id: doc._id,
      title: doc.title,
      docType: doc.docType,
      content: doc.content,
      revision: doc.revision,
      updatedAt: doc.updatedAt,
      archivedAt: doc.archivedAt,
    };
  },
});

/** A new document, starting from its type's template. */
export const create = mutation({
  args: { docType, title: v.optional(v.string()) },
  handler: async (ctx, { docType: type, title }) => {
    await requireUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("studioDocs", {
      title: (title ?? "").trim(),
      docType: type,
      content: JSON.stringify(templateFor(type)),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Write the document, if the writer was looking at the current version.
 *
 * `revision` is the version this content was edited from. If the stored
 * document has moved on, this save is carrying older text and applying it would
 * delete whatever landed in between — and nothing would look wrong, because the
 * editor that sent it still shows the newer text on screen.
 *
 * That happens without a second person and without a second tab: two saves in
 * flight, the first one slow, and it lands last.
 *
 * The caller is told, rather than the failure being swallowed. A save that
 * cannot be applied has to reach the screen or it is just a slower way to lose
 * the same text.
 */
export const save = mutation({
  args: {
    id: v.id("studioDocs"),
    content: v.string(),
    revision: v.number(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { id, content, revision, title }) => {
    await requireUser(ctx);
    const doc = await ctx.db.get(id);
    if (!doc) return { ok: false as const, reason: "missing" as const };

    if (doc.revision !== revision) {
      return {
        ok: false as const,
        reason: "stale" as const,
        revision: doc.revision,
      };
    }

    if (content.length > MAX_CONTENT_BYTES) {
      return { ok: false as const, reason: "too_large" as const, revision: doc.revision };
    }

    const value = parse(content);
    const next = doc.revision + 1;
    await ctx.db.patch(id, {
      content,
      // An explicit title wins; otherwise the first line with words in it names
      // the document, so an untitled note still reads as something in the index.
      title: (title ?? "").trim() || deriveTitle(value),
      revision: next,
      updatedAt: Date.now(),
    });
    return { ok: true as const, revision: next };
  },
});

export const rename = mutation({
  args: { id: v.id("studioDocs"), title: v.string() },
  handler: async (ctx, { id, title }) => {
    await requireUser(ctx);
    const doc = await ctx.db.get(id);
    if (!doc) return { ok: false as const };
    // A rename is a change like any other, so it moves the counter too.
    await ctx.db.patch(id, {
      title: title.trim().slice(0, 120),
      revision: doc.revision + 1,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Archive and restore, so nothing is destroyed by a mis-tap. */
export const setArchived = mutation({
  args: { id: v.id("studioDocs"), archived: v.boolean() },
  handler: async (ctx, { id, archived }) => {
    await requireUser(ctx);
    const doc = await ctx.db.get(id);
    if (!doc) return { ok: false as const };
    await ctx.db.patch(id, {
      archivedAt: archived ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Permanent deletion, with the document's history. */
export const remove = mutation({
  args: { id: v.id("studioDocs") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const versions = await ctx.db
      .query("studioVersions")
      .withIndex("by_doc", (q) => q.eq("docId", id))
      .collect();
    for (const version of versions) await ctx.db.delete(version._id);
    await ctx.db.delete(id);
    return { ok: true as const };
  },
});

/** Keep this moment, so there is something to come back to. */
export const snapshot = mutation({
  args: { id: v.id("studioDocs"), label: v.optional(v.string()) },
  handler: async (ctx, { id, label }) => {
    await requireUser(ctx);
    const doc = await ctx.db.get(id);
    if (!doc) return { ok: false as const };
    await ctx.db.insert("studioVersions", {
      docId: id,
      title: doc.title,
      content: doc.content,
      revision: doc.revision,
      label: label?.trim() || undefined,
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const versions = query({
  args: { id: v.id("studioDocs") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("studioVersions")
      .withIndex("by_doc", (q) => q.eq("docId", id))
      .order("desc")
      .take(50);
    // No bodies here either — the list is for choosing, and a body is only
    // needed once one is chosen.
    return rows.map((r) => ({
      _id: r._id,
      title: r.title,
      revision: r.revision,
      label: r.label,
      createdAt: r.createdAt,
      excerpt: excerpt(parse(r.content), EXCERPT_CHARS),
    }));
  },
});

/**
 * Put an old version back.
 *
 * Two things have to be true afterwards, and both are easy to get wrong.
 *
 * The counter CLIMBS. Restoring yesterday's content does not restore
 * yesterday's number — the number is not part of the document, it records how
 * many times the document has moved. Leaving it alone would let a tab that has
 * been open since yesterday still hold a passing stamp, and its next autosave
 * would quietly wipe the restore out.
 *
 * And the content being replaced is kept first, so a restore is not a one-way
 * door. Undoing a mistaken restore has to be possible.
 */
export const restoreVersion = mutation({
  args: { id: v.id("studioDocs"), versionId: v.id("studioVersions") },
  handler: async (ctx, { id, versionId }) => {
    await requireUser(ctx);
    const doc = await ctx.db.get(id);
    const version = await ctx.db.get(versionId);
    if (!doc || !version || version.docId !== id) return { ok: false as const };

    const now = Date.now();
    await ctx.db.insert("studioVersions", {
      docId: id,
      title: doc.title,
      content: doc.content,
      revision: doc.revision,
      label: "before restore",
      createdAt: now,
    });

    const next = doc.revision + 1;
    await ctx.db.patch(id, {
      title: version.title,
      content: version.content,
      revision: next,
      updatedAt: now,
    });
    return { ok: true as const, revision: next };
  },
});
