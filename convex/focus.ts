import { query } from "./_generated/server";
import { requireUser } from "./dashboard";
import { mentions } from "./mentionsLib";

/**
 * PARA as a lens, with nothing filed.
 *
 * Tiago Forte's method is right about one thing above all: organise for
 * ACTIONABILITY, not for subject. It is wrong for this system in one way that
 * matters — it is a filing method, and the finding this whole design rests on
 * is that every PKM method dies at the point where filing becomes a weekly
 * chore.
 *
 * So the language survives and the filing does not. A "project" here is an
 * active telos item that already exists; what hangs off it is read from
 * columns and from string facts, never assigned by hand and never queued for
 * approval. Nothing on this page can be tidied, because there is nothing here
 * that a human put in place.
 *
 * Two strengths of connection, kept distinct because ticket 06 says the
 * strength of the claim must match the strength of the record:
 *   supports  — a real foreign key (habits.telosItemId). Speak it as fact.
 *   mentions  — the text literally carries the goal's distinctive words. Also
 *               a fact, but a fact about strings, so it is labelled as such.
 */

/** Mission is context, not work; strategy and dimension are not actionable on their own. */
const ACTIONABLE = new Set(["goal", "problem", "challenge"]);

/** Enough to be useful under a goal, few enough to stay a summary. */
const PER_SECTION = 6;

const DAY = 86_400_000;

export const focus = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const [telos, habits, decisions, loops, documents] = await Promise.all([
      ctx.db.query("telosItems").take(200),
      ctx.db.query("habits").take(200),
      ctx.db.query("decisions").order("desc").take(200),
      ctx.db.query("openLoops").order("desc").take(200),
      ctx.db.query("documents").order("desc").take(200),
    ]);

    const items = telos
      .filter((t) => t.status === "active" && ACTIONABLE.has(t.kind))
      // Most overdue for a look first. Not a nag and not a count — just an
      // order, so the thing he has not thought about is not at the bottom.
      .sort((a, b) => dueness(b) - dueness(a));

    const now = Date.now();
    return items.map((t) => ({
      id: t._id as string,
      kind: t.kind,
      text: t.text,
      measurable: t.measurable,
      reviewedDaysAgo: Math.floor((now - t.reviewedAt) / DAY),
      cadenceDays: t.reviewCadenceDays,
      // The one real edge into telos. Stated as fact because it is one.
      supports: habits
        .filter((h) => h.telosItemId === t._id && h.status === "active")
        .slice(0, PER_SECTION)
        .map((h) => ({ id: h._id as string, label: h.identity })),
      decisions: decisions
        .filter((d) => mentions(`${d.what} ${d.why}`, t.text))
        .slice(0, PER_SECTION)
        .map((d) => ({ id: d._id as string, label: d.what })),
      loops: loops
        .filter((l) => l.status === "open" && mentions(l.text, t.text))
        .slice(0, PER_SECTION)
        .map((l) => ({ id: l._id as string, label: l.text })),
      documents: documents
        .filter((d) => mentions(d.title, t.text))
        .slice(0, PER_SECTION)
        .map((d) => ({ id: d._id as string, label: d.title })),
    }));
  },
});

/** How far past its own review cadence an item has drifted. Negative is fine. */
function dueness(t: { reviewedAt: number; reviewCadenceDays: number }): number {
  return (Date.now() - t.reviewedAt) / DAY - t.reviewCadenceDays;
}
