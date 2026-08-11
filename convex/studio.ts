import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireUser } from "./dashboard";
import {
  blockText,
  deriveTitle,
  excerpt,
  parseValue,
  replaceBlockText,
  templateFor,
} from "./studioLib.ts";

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

/**
 * The stored tree, or an empty document if it cannot be read.
 *
 * The rule lives in studioLib now: four callers need it, and a private copy in
 * each is four places for the malformed-content rule to drift apart.
 */
const parse = parseValue;

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

/**
 * Permanent deletion, with everything attached to the document.
 *
 * Its history, its references, and its proposals — all keyed by a docId that
 * is about to stop existing. Rows left behind here are not merely untidy: a
 * pending proposal still counts toward the index badge, and a reference chip
 * still claims to point at something.
 */
export const remove = mutation({
  args: { id: v.id("studioDocs") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const versions = await ctx.db
      .query("studioVersions")
      .withIndex("by_doc", (q) => q.eq("docId", id))
      .collect();
    for (const version of versions) await ctx.db.delete(version._id);

    const refs = await ctx.db
      .query("studioRefs")
      .withIndex("by_doc", (q) => q.eq("docId", id))
      .collect();
    for (const ref of refs) await ctx.db.delete(ref._id);

    const attached = await ctx.db
      .query("studioProposals")
      .withIndex("by_doc_status", (q) => q.eq("docId", id))
      .collect();
    for (const proposal of attached) await ctx.db.delete(proposal._id);

    await ctx.db.delete(id);
    return { ok: true as const };
  },
});

/**
 * Keep this moment, so there is something to come back to.
 *
 * Also the moment the document is embedded. That is a deliberate choice and the
 * reason it is written here rather than in `save`: `save` fires on a 900ms
 * debounce while someone is typing, so embedding there would call Voyage
 * several times per sentence, for text that is mid-word. Keeping a version is
 * the one act in Studio that means "this is worth coming back to" — which is
 * exactly the text worth being findable.
 *
 * Between snapshots a document is still findable by WORDS, because text recall
 * ranks the live rows; only the semantic half waits. And nothing is lost if
 * Tarik never keeps a version: the nightly consolidation runs the same backfill
 * and picks up every document whose embedding is behind its revision.
 */
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
    await ctx.scheduler.runAfter(0, internal.memoryOps.backfillEmbeddings, {});
    return { ok: true as const };
  },
});

// ------------------------------------------------------------- proposals
//
// Zola proposes; Tarik decides. She has no way to show him a diff over a phone
// call, so she never applies one — and that is not a limitation to engineer
// around, it is the rule that makes it safe to let her near his writing.
//
// One table serves both origins, so there is ONE review panel. A second review
// UI for the voice path would be the same disagreement two brief stores would
// have caused: two places that must always agree, and eventually will not.

/** What is waiting in this document. */
export const proposals = query({
  args: { id: v.id("studioDocs") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    return await ctx.db
      .query("studioProposals")
      .withIndex("by_doc_status", (q) => q.eq("docId", id).eq("status", "pending"))
      .order("desc")
      .take(20);
  },
});

/** How many are waiting, for the index — without shipping the text of any. */
export const pendingCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const pending = await ctx.db
      .query("studioProposals")
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    const counts: Record<string, number> = {};
    for (const p of pending) counts[p.docId] = (counts[p.docId] ?? 0) + 1;
    return counts;
  },
});

/**
 * Take the rewrite.
 *
 * Refuses if that block no longer says what it said when the proposal was
 * made. A proposal can sit for an hour, and in that hour the paragraph may have
 * been rewritten by hand — applying anyway would delete the rewrite, and the
 * screen would look entirely correct afterwards. This is the same failure the
 * revision counter exists to prevent, one block down.
 */
export const acceptProposal = mutation({
  args: { id: v.id("studioProposals") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const proposal = await ctx.db.get(id);
    if (!proposal || proposal.status !== "pending") {
      return { ok: false as const, reason: "gone" as const };
    }
    const doc = await ctx.db.get(proposal.docId);
    if (!doc) return { ok: false as const, reason: "missing" as const };

    const value = parse(doc.content);
    const block = value[proposal.blockIndex];
    const current = block ? blockText(block) : undefined;
    if (current !== proposal.original) {
      return { ok: false as const, reason: "moved" as const };
    }

    const next = replaceBlockText(value, proposal.blockIndex, proposal.proposed);
    const revision = doc.revision + 1;
    await ctx.db.patch(proposal.docId, {
      content: JSON.stringify(next),
      title: doc.title || deriveTitle(next),
      revision,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(id, { status: "applied", resolvedAt: Date.now() });
    return { ok: true as const, revision };
  },
});

/** Leave it. The document is not touched, and the proposal stops asking. */
export const rejectProposal = mutation({
  args: { id: v.id("studioProposals") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const proposal = await ctx.db.get(id);
    if (!proposal || proposal.status !== "pending") {
      return { ok: false as const };
    }
    await ctx.db.patch(id, { status: "rejected", resolvedAt: Date.now() });
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
