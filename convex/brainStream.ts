import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./dashboard";

/**
 * Everything Zola has learned, as one stream.
 *
 * The three-column version of this page split rows by which TABLE they live in
 * — memories, thoughts, journal. That is the database showing through: nobody
 * wakes up wondering whether something was a memory or a thought. What he does
 * wonder is whether she has got something wrong, and the answer to that is
 * ordered by time, not by storage.
 *
 * So: one stream, newest first, every row carrying where it came from and a way
 * to fix it. Correcting her is the only chore in this system that pays for
 * itself — an uncorrected wrong memory is repeated back as fact forever.
 */

/** Per-table ceiling. The stream is for checking recent work, not for browsing. */
const PER_KIND = 150;

export type StreamKind =
  | "decision"
  | "open_loop"
  | "fact"
  | "preference"
  | "project"
  | "person"
  | "thought"
  | "capture"
  | "reflection";

export type StreamItem = {
  id: string;
  table: "decisions" | "openLoops" | "memories" | "thoughts" | "journalEntries";
  kind: StreamKind;
  text: string;
  /** Only decisions have one. It is the field that makes a decision a decision. */
  why?: string;
  at: number;
  /** Where it came from, in words. Provenance is what makes the row trustable. */
  source: string;
  transcriptId?: string;
  tags?: string[];
};

export const stream = query({
  args: {},
  handler: async (ctx): Promise<StreamItem[]> => {
    await requireUser(ctx);
    const [decisions, loops, memories, thoughts, journal] = await Promise.all([
      ctx.db.query("decisions").order("desc").take(PER_KIND),
      ctx.db.query("openLoops").order("desc").take(PER_KIND),
      ctx.db.query("memories").order("desc").take(PER_KIND),
      ctx.db.query("thoughts").order("desc").take(PER_KIND),
      ctx.db.query("journalEntries").order("desc").take(PER_KIND),
    ]);

    // Titles for the conversations these rows came out of. One fetch for the
    // whole stream rather than one per row.
    const ids = new Set<string>();
    for (const r of [...memories, ...thoughts, ...decisions, ...loops]) {
      if (r.transcriptId) ids.add(r.transcriptId);
    }
    const titles = new Map<string, string>();
    await Promise.all(
      [...ids].map(async (id) => {
        const t = await ctx.db.get(id as never);
        if (t && "title" in t) titles.set(id, (t as { title: string }).title);
      }),
    );
    const from = (transcriptId?: string) =>
      transcriptId ? `from ${titles.get(transcriptId) ?? "a conversation"}` : "";

    const items: StreamItem[] = [
      ...decisions.map((d) => ({
        id: d._id as string,
        table: "decisions" as const,
        kind: "decision" as const,
        text: d.what,
        why: d.why,
        at: d.decidedAt,
        source: from(d.transcriptId) || "said out loud",
        transcriptId: d.transcriptId as string | undefined,
      })),
      ...loops
        .filter((l) => l.status === "open")
        .map((l) => ({
          id: l._id as string,
          table: "openLoops" as const,
          kind: "open_loop" as const,
          text: l.text,
          at: l.openedAt,
          source: [l.person ? `with ${l.person}` : "", from(l.transcriptId)]
            .filter(Boolean)
            .join(" · ") || "said out loud",
          transcriptId: l.transcriptId as string | undefined,
        })),
      ...memories.map((m) => ({
        id: m._id as string,
        table: "memories" as const,
        kind: m.type as StreamKind,
        text: m.content,
        at: m.updatedAt ?? m._creationTime,
        // A memory with no transcript came out of the nightly consolidation
        // reading everything at once — worth saying, because it is the path
        // where she is most likely to have over-read a passing remark.
        source: from(m.transcriptId) || "learned overnight",
        transcriptId: m.transcriptId as string | undefined,
      })),
      ...thoughts.map((t) => ({
        id: t._id as string,
        table: "thoughts" as const,
        kind: "thought" as const,
        text: t.cleaned,
        at: t._creationTime,
        source: from(t.transcriptId) || "captured",
        transcriptId: t.transcriptId as string | undefined,
        tags: t.tags,
      })),
      ...journal.map((j) => ({
        id: j._id as string,
        table: "journalEntries" as const,
        kind: j.mode as StreamKind,
        text: j.text,
        at: j._creationTime,
        source: j.consolidatedAt ? "journal · mined" : "journal",
      })),
    ];

    return items.sort((a, b) => b.at - a.at);
  },
});

/**
 * Fix a row in place.
 *
 * One mutation across five tables rather than five near-identical ones: the row
 * carries which table it belongs to, and the UI does not have to know. If a
 * sixth store lands, this is one line.
 */
export const editItem = mutation({
  args: {
    table: v.union(
      v.literal("decisions"),
      v.literal("openLoops"),
      v.literal("memories"),
      v.literal("thoughts"),
      v.literal("journalEntries"),
    ),
    id: v.string(),
    text: v.string(),
  },
  handler: async (ctx, { table, id, text }) => {
    await requireUser(ctx);
    const trimmed = text.trim();
    if (!trimmed) throw new Error("A correction cannot be empty — delete it instead.");
    const _id = ctx.db.normalizeId(table, id);
    if (!_id) throw new Error("No such row.");
    // The embedding described the OLD text. Clearing it takes the row out of
    // semantic recall until the backfill re-embeds it, which is the safe
    // direction: a stale vector makes a corrected memory findable by the words
    // he just removed.
    switch (table) {
      case "decisions":
        return ctx.db.patch(_id, { what: trimmed, embedding: undefined });
      case "openLoops":
        return ctx.db.patch(_id, { text: trimmed, embedding: undefined });
      case "memories":
        return ctx.db.patch(_id, {
          content: trimmed,
          updatedAt: Date.now(),
          embedding: undefined,
        });
      case "thoughts":
        return ctx.db.patch(_id, { cleaned: trimmed, embedding: undefined });
      case "journalEntries":
        return ctx.db.patch(_id, { text: trimmed, embedding: undefined });
    }
  },
});

export const deleteItem = mutation({
  args: {
    table: v.union(
      v.literal("decisions"),
      v.literal("openLoops"),
      v.literal("memories"),
      v.literal("thoughts"),
      v.literal("journalEntries"),
    ),
    id: v.string(),
  },
  handler: async (ctx, { table, id }) => {
    await requireUser(ctx);
    const _id = ctx.db.normalizeId(table, id);
    if (!_id) throw new Error("No such row.");
    await ctx.db.delete(_id);
  },
});

/** Closing a loop from the screen. Same end state as saying it out loud. */
export const closeLoopById = mutation({
  args: { id: v.id("openLoops") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    await ctx.db.patch(id, { status: "closed", closedAt: Date.now() });
  },
});
