import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Weekday morning brief. Convex crons are UTC-only: 12:00 UTC = 7:00 AM
// CDT (America/Chicago in summer); it drifts to 6:00 AM CST after the
// November DST flip — adjust to 13 then if the earlier hour bothers Tarik.
crons.cron(
  "morning brief",
  "0 12 * * 1-5",
  internal.workflowRunner.run,
  { name: "morning-brief" },
);

// Sunday weekly telos review brief. 14:00 UTC = 9:00 AM CDT (8:00 AM CST).
crons.cron(
  "weekly review",
  "0 14 * * 0",
  internal.workflowRunner.run,
  { name: "weekly-review" },
);

// Nightly memory consolidation. 08:00 UTC = 3:00 AM CDT (2:00 AM CST).
crons.cron(
  "memory consolidation",
  "0 8 * * *",
  internal.workflowRunner.run,
  { name: "memory-consolidation" },
);

// Evening habit check-in. 23:00 UTC = 6:00 PM CDT (5:00 PM CST). It composes
// a card and waits — see convex/habitsCron.ts.
crons.cron(
  "habit evening check-in",
  "0 23 * * *",
  internal.habitsCron.eveningCheckIn,
  {},
);

// Contact sync. 09:00 UTC = 4:00 AM CDT — before the morning brief, so a name
// added yesterday resolves today, and well clear of the 12:00 brief run.
//
// A full pull rather than an incremental one: the observable requirement (edit
// a contact, see it next sync) is met either way, and a full pull cannot
// drift, whereas an incremental one has to apply tombstones correctly forever
// or the store silently diverges from Google.
crons.cron(
  "contact sync",
  "0 9 * * *",
  internal.contactsCron.sync,
  {},
);

export default crons;
