import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret } from "./secondBrain";
import { requireUser } from "./dashboard";
import {
  checkShareAccess,
  isConfirmationValid,
  newConfirmation,
  newShareSlug,
} from "./documentsLib.ts";

// Sharing is the only write in Tarik OS that reaches past Clerk: `/f/<slug>`
// answers with no session. So it is two calls, not one — ask, then act — and
// the second call is the only door. `tests/documentShareGuardrail.test.ts`
// pins that there is no second one.
//
// The design assumed a spoken-confirm ritual already existed in the tool
// route. It did not; what existed was prompt text asking the model to say a
// sentence first. This is the structural version of that.
//
// Both phases run inside a Convex transaction, which is what makes "check the
// token, spend it, write the link" a single indivisible step rather than a
// race a second concurrent call could slip through.

/**
 * Phase one. Names the document so Zola can read it back, hands out a
 * single-use token, and writes no link.
 */
export const requestShare = mutation({
  args: {
    secret: v.optional(v.string()),
    documentId: v.id("documents"),
  },
  handler: async (ctx, { secret, documentId }) => {
    if (secret) checkToolSecret(secret);
    else await requireUser(ctx);

    const doc = await ctx.db.get(documentId);
    if (!doc) throw new Error("No such document.");

    const now = Date.now();
    const confirmation = newConfirmation(documentId, now);
    await ctx.db.insert("documentShareConfirmations", {
      token: confirmation.token,
      documentId,
      expiresAt: confirmation.expiresAt,
      used: confirmation.used,
      createdAt: now,
    });

    return {
      requiresConfirmation: true,
      confirmationToken: confirmation.token,
      expiresAt: confirmation.expiresAt,
      summary: `${doc.title} — ${doc.filename}`,
    };
  },
});

/**
 * Phase two, and the only path to a documentShareLinks row.
 *
 * The token is spent *before* the insert on purpose: if anything throws
 * between the two, Convex rolls the whole mutation back, but ordering it this
 * way means no reading of the code suggests a window where a link exists and
 * its token is still live.
 */
export const createShareLink = mutation({
  args: {
    secret: v.optional(v.string()),
    documentId: v.id("documents"),
    confirmationToken: v.string(),
    expiresAt: v.optional(v.number()),
    maxDownloads: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { secret, documentId, confirmationToken, expiresAt, maxDownloads },
  ) => {
    if (secret) checkToolSecret(secret);
    else await requireUser(ctx);

    const now = Date.now();
    const record = await ctx.db
      .query("documentShareConfirmations")
      .withIndex("by_token", (q) => q.eq("token", confirmationToken))
      .unique();

    if (
      !record ||
      !isConfirmationValid(record, {
        token: confirmationToken,
        documentId,
        now,
      })
    ) {
      // One opaque message for every denial — missing, spent, expired, wrong
      // document, wrong token. Which one it was is not the caller's business.
      throw new Error("That share was not confirmed.");
    }

    await ctx.db.patch(record._id, { used: true });

    const slug = newShareSlug();
    await ctx.db.insert("documentShareLinks", {
      documentId,
      slug,
      expiresAt,
      maxDownloads,
      downloadCount: 0,
      revoked: false,
      createdAt: now,
    });

    return { slug, expiresAt, maxDownloads };
  },
});

/**
 * The public read path, behind the tool secret.
 *
 * `/f/<slug>` has no session, so the route is the only thing standing between
 * a guessed slug and an object key — and the route holds the secret. Without
 * it, anyone with the deployment URL could trade guesses against Convex
 * directly and skip the route entirely.
 *
 * Every denial returns the same bare `{ ok: false }`. The reasons go to the
 * deployment log and no further: which slugs exist, and why a particular one
 * is dead, is not something a stranger gets to learn. (console is Convex's
 * logging interface — there is no logger to inject inside the isolate.)
 */
export const resolveShare = mutation({
  args: {
    secret: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, { secret, slug }) => {
    checkToolSecret(secret);

    const link = await ctx.db
      .query("documentShareLinks")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (!link) {
      console.warn(`share: unknown slug`);
      return { ok: false as const };
    }

    const verdict = checkShareAccess(link, Date.now());
    if (!verdict.allowed) {
      console.warn(`share: denied ${link._id} — ${verdict.reasons.join(", ")}`);
      return { ok: false as const };
    }

    const doc = await ctx.db.get(link.documentId);
    if (!doc) {
      // The row survived its document. Nothing to serve, same answer.
      console.warn(`share: link ${link._id} points at a missing document`);
      return { ok: false as const };
    }

    // Only a visit that will actually be served counts. Incrementing before
    // the check would let a revoked link burn down someone else's cap and
    // would log traffic as downloads that never happened.
    await ctx.db.patch(link._id, { downloadCount: link.downloadCount + 1 });

    return {
      ok: true as const,
      objectKey: doc.objectKey,
      filename: doc.filename,
    };
  },
});
