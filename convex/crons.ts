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

// Nightly memory consolidation. 08:00 UTC = 3:00 AM CDT (2:00 AM CST).
crons.cron(
  "memory consolidation",
  "0 8 * * *",
  internal.workflowRunner.run,
  { name: "memory-consolidation" },
);

export default crons;
