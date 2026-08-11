import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret } from "./secondBrain";
import { rankContacts } from "./contactsLib.ts";

// Contacts storage and lookup (MOO-499).
//
// Secret-gated rather than user-gated, like the other tool-facing functions:
// the callers are the sync route and the find_contact tool route, neither of
// which has a Clerk session.
//
// One-way from the providers. Nothing here is edited inside TarikOS, so a sync
// can overwrite freely and there is no conflict to resolve.

const contactShape = v.object({
  key: v.string(),
  name: v.string(),
  phones: v.array(v.string()),
  emails: v.array(v.string()),
  org: v.optional(v.string()),
  photo: v.optional(v.string()),
  sources: v.array(
    v.object({
      source: v.union(v.literal("google"), v.literal("icloud")),
      sourceId: v.string(),
    }),
  ),
});

/**
 * Write one batch of a sync.
 *
 * Batched because a full sync is ~4,800 rows and a single mutation cannot
 * carry them. Every row is stamped with the run's `syncedAt`, which is what
 * lets sweepStale afterwards tell "not in this sync" from "not yet written".
 */
export const upsertBatch = mutation({
  args: {
    secret: v.string(),
    syncedAt: v.number(),
    contacts: v.array(contactShape),
  },
  handler: async (ctx, { secret, syncedAt, contacts }) => {
    checkToolSecret(secret);
    let created = 0;
    let updated = 0;
    for (const contact of contacts) {
      if (!contact.key) continue;
      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_key", (q) => q.eq("key", contact.key))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { ...contact, syncedAt });
        updated++;
      } else {
        await ctx.db.insert("contacts", { ...contact, syncedAt });
        created++;
      }
    }
    return { created, updated };
  },
});

/**
 * Remove contacts the provider no longer has.
 *
 * A row still carrying an older stamp was not seen in this run, which means it
 * was deleted upstream. Bounded per call so a large purge cannot blow the
 * mutation limit, and it reports whether more remain so the caller can repeat.
 *
 * Deliberately takes the run's own timestamp rather than "now": using now
 * would sweep rows written moments ago by a concurrent sync.
 */
export const sweepStale = mutation({
  args: { secret: v.string(), syncedAt: v.number(), limit: v.number() },
  handler: async (ctx, { secret, syncedAt, limit }) => {
    checkToolSecret(secret);
    const stale = await ctx.db
      .query("contacts")
      .withIndex("by_synced", (q) => q.lt("syncedAt", syncedAt))
      .take(limit);
    for (const row of stale) await ctx.db.delete(row._id);
    return { deleted: stale.length, more: stale.length === limit };
  },
});

/** Ranked matches for a spoken name, number or address. */
export const search = query({
  args: { secret: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, query: text, limit }) => {
    checkToolSecret(secret);
    // The book is small enough to rank in memory (~4,800 rows) and the
    // matching is fuzzy in ways an index cannot express — prefix-per-word,
    // normalized phone equality, org fallback.
    const all = await ctx.db.query("contacts").collect();
    const matches = rankContacts(all, text, limit ?? 5);
    return {
      // The total is what lets Zola say "I have eight, here are five" rather
      // than presenting a truncated list as though it were complete.
      total: rankContacts(all, text, all.length).length,
      matches: matches.map((m) => ({
        name: m.name,
        phones: m.phones,
        emails: m.emails,
        org: m.org,
      })),
    };
  },
});

/** Count and freshness, for the dashboard and for sync health. */
export const stats = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    const all = await ctx.db.query("contacts").collect();
    return {
      total: all.length,
      reachable: all.filter((c) => c.phones.length || c.emails.length).length,
      lastSyncedAt: all.reduce((max, c) => Math.max(max, c.syncedAt), 0),
    };
  },
});
