import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret } from "./secondBrain";
import { requireUser } from "./dashboard";
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
    // Ranked ONCE. Ranking a second time purely to count the total scored
    // every contact twice on every keystroke of the contacts page.
    const ranked = rankContacts(all, text, all.length);
    const matches = ranked.slice(0, limit ?? 5);
    return {
      // The total is what lets Zola say "I have eight, here are five" rather
      // than presenting a truncated list as though it were complete.
      total: ranked.length,
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

/**
 * The book for the /contacts page. Clerk-gated, not secret-gated — this one
 * has a browser session behind it, unlike the tool routes above.
 *
 * Returns rows for the client to search in memory rather than a query per
 * keystroke: matching is fuzzy in ways an index cannot express, and a round
 * trip per character on a 4,800-row scan is the slower answer anyway.
 *
 * Unreachable contacts are excluded by default. 4,033 of the 4,825 have
 * neither a phone nor an email — addresses Gmail collected from people Tarik
 * emailed once — so the unfiltered list is 84% noise and several times the
 * payload on a phone.
 */
export const book = query({
  args: { includeUnreachable: v.optional(v.boolean()) },
  handler: async (ctx, { includeUnreachable }) => {
    await requireUser(ctx);
    const all = await ctx.db.query("contacts").collect();
    const rows = includeUnreachable
      ? all
      : all.filter((c) => c.phones.length > 0 || c.emails.length > 0);
    return {
      total: all.length,
      reachable: all.filter((c) => c.phones.length > 0 || c.emails.length > 0).length,
      lastSyncedAt: all.reduce((max, c) => Math.max(max, c.syncedAt), 0),
      contacts: rows
        .map((c) => ({
          key: c.key,
          name: c.name,
          phones: c.phones,
          emails: c.emails,
          org: c.org,
          photo: c.photo,
          sources: c.sources,
        }))
        // People with a phone first, then alphabetical.
        //
        // Having an email is not evidence of being a person: most of the
        // "reachable" 792 are addresses Gmail collected from things he was
        // mailed BY, and sorted by name alone the list opens on
        // "02 Asana - Mobile App Tasks" and eight of its siblings. A phone
        // number is the closest thing to a signal that someone is a human he
        // deals with — nothing auto-collects one.
        .sort(
          (a, z) =>
            Number(z.phones.length > 0) - Number(a.phones.length > 0) ||
            (a.name || "\uffff").localeCompare(z.name || "\uffff"),
        ),
    };
  },
});
