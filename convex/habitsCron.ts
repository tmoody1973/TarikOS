import { internalMutation } from "./_generated/server";
import { chicagoToday } from "./workflowLib.ts";

/* Evening check-in (MOO-505). Composes a card that waits on the dashboard,
 * exactly as the morning brief does. There is no push channel yet, and that
 * is deliberate — this cannot nag, by construction. When MOO-497 lands, an
 * SMS nudge can read the same card. */
export const eveningCheckIn = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cycle = await ctx.db
      .query("habitCycles")
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (!cycle) return;

    const habits = (
      await ctx.db
        .query("habits")
        .withIndex("by_cycle", (q) => q.eq("cycleId", cycle._id))
        .collect()
    ).filter((h) => h.status === "active");
    if (habits.length === 0) return;

    const date = chicagoToday();
    const open: string[] = [];
    for (const habit of habits) {
      const vote = await ctx.db
        .query("habitVotes")
        .withIndex("by_habit_date", (q) =>
          q.eq("habitId", habit._id).eq("date", date),
        )
        .unique();
      if (!vote) open.push(habit.pillar);
    }

    await ctx.db.insert("briefingCards", {
      kind: "note",
      title: open.length === 0 ? "All votes are in" : "Evening check-in",
      body:
        open.length === 0
          ? `Every pillar has a vote today. Anything worth noting before you close the day?`
          : `Still open: ${open.join(", ")}. Which of these happened today?`,
    });
  },
});
