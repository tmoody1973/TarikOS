import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { requireUser } from "./dashboard";
import { checkToolSecret, markToolHealthy } from "./secondBrain";
import { seedSettingIfAbsent, upsertSetting } from "./settingsLib";
import { safeSlice } from "./workflowLib";
import type { Doc } from "./_generated/dataModel";

// Workflow-engine data layer: the runner action (workflowRunner.ts) drives
// these internal functions; the public ones serve the Briefs page and the
// get_brief voice tool.

export const sectionValidator = v.object({
  heading: v.string(),
  body: v.string(),
  tool: v.string(),
  updatedAt: v.number(),
  sources: v.array(v.object({ title: v.string(), url: v.string() })),
});

export const getByName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    return await ctx.db
      .query("workflows")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
  },
});

export const getSetting = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row?.value ?? null;
  },
});

export const createOrResetBrief = internalMutation({
  args: {
    briefId: v.optional(v.id("briefs")),
    title: v.string(),
    workflowName: v.string(),
    runStartedAt: v.number(),
  },
  handler: async (ctx, { briefId, title, workflowName, runStartedAt }) => {
    if (briefId) {
      await ctx.db.patch(briefId, {
        title,
        status: "building",
        runStartedAt,
        sections: [],
      });
      return briefId;
    }
    return await ctx.db.insert("briefs", {
      title,
      workflowName,
      status: "building",
      runStartedAt,
      sections: [],
    });
  },
});

export const appendSection = internalMutation({
  args: { briefId: v.id("briefs"), section: sectionValidator },
  handler: async (ctx, { briefId, section }) => {
    const brief = await ctx.db.get(briefId);
    if (!brief) return;
    await ctx.db.patch(briefId, { sections: [...brief.sections, section] });
  },
});

export const finishBrief = internalMutation({
  args: {
    briefId: v.id("briefs"),
    status: v.union(v.literal("ready"), v.literal("error")),
    workflowName: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { briefId, status, workflowName, error }) => {
    await ctx.db.patch(briefId, { status });
    const workflow = await ctx.db
      .query("workflows")
      .withIndex("by_name", (q) => q.eq("name", workflowName))
      .unique();
    if (workflow) {
      await ctx.db.patch(workflow._id, {
        lastRunAt: Date.now(),
        lastError: error,
      });
    }
  },
});

// Marks a brief stuck in "building" as errored. runStartedAt guards against
// a later refresh's build being killed by a stale watchdog.
export const watchdog = internalMutation({
  args: { briefId: v.id("briefs"), runStartedAt: v.number() },
  handler: async (ctx, { briefId, runStartedAt }) => {
    const brief = await ctx.db.get(briefId);
    if (!brief || brief.status !== "building") return;
    if (brief.runStartedAt !== runStartedAt) return;
    await ctx.db.patch(briefId, { status: "error" });
    const workflow = await ctx.db
      .query("workflows")
      .withIndex("by_name", (q) => q.eq("name", brief.workflowName))
      .unique();
    if (workflow) {
      await ctx.db.patch(workflow._id, {
        lastError: "Workflow timed out (stuck building >5 min)",
      });
    }
  },
});

// ---- Briefs page (browser, identity-gated) ----

// Archive summary shape (MOO-495): headings + a capped excerpt power the
// rail's content search and find_brief scoring without shipping full bodies.
// ponytail: 100-brief window; paginate if the archive ever outgrows it.
const EXCERPT_CAP = 800;
const ARCHIVE_WINDOW = 100;

// Early-exit accumulation — never materialize a brief's full body just to
// throw away everything past the cap.
function excerptOf(sections: { body: string }[]): string {
  let out = "";
  for (const s of sections) {
    if (out.length >= EXCERPT_CAP) break;
    out += (out ? " " : "") + s.body;
  }
  return safeSlice(out, EXCERPT_CAP);
}

function toBriefSummary(b: Doc<"briefs">) {
  return {
    _id: b._id,
    _creationTime: b._creationTime,
    title: b.title,
    workflowName: b.workflowName,
    status: b.status,
    headings: b.sections.map((s) => s.heading),
    // Empty while building: keeps the live-query result byte-stable across
    // section-by-section patches, so clients aren't pushed ~100 summaries
    // per patch for a change the rail shows as one pulsing dot.
    excerpt: b.status === "ready" ? excerptOf(b.sections) : "",
  };
}

export const listBriefs = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const briefs = await ctx.db.query("briefs").order("desc").take(ARCHIVE_WINDOW);
    return briefs.map(toBriefSummary);
  },
});

// find_brief voice tool reads the same summaries, secret-gated.
export const briefSummariesFromTool = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    const briefs = await ctx.db.query("briefs").order("desc").take(ARCHIVE_WINDOW);
    return briefs.map(toBriefSummary);
  },
});

export const getBrief = query({
  args: { briefId: v.id("briefs") },
  handler: async (ctx, { briefId }) => {
    await requireUser(ctx);
    return await ctx.db.get(briefId);
  },
});

// ---- get_brief voice tool (secret-gated, called by the tool route) ----

export const latestReadyBrief = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    // Operational logs are not editions: the 3am consolidation run must
    // never be what "good morning" speaks (MOO-495).
    return await ctx.db
      .query("briefs")
      .order("desc")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "ready"),
          q.neq(q.field("workflowName"), "memory-consolidation"),
        ),
      )
      .first();
  },
});

export const markBriefToolHealthy = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    await markToolHealthy(ctx, "get_brief");
  },
});

export const markNamedToolHealthy = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    await markToolHealthy(ctx, name);
  },
});

// Voice-triggered workflow launch (run_workflow tool). Fire-and-return so
// Zola can speak immediately while the brief builds.
export const runFromTool = action({
  args: {
    secret: v.string(),
    name: v.string(),
    topic: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { secret, name, topic },
  ): Promise<{ ok: boolean; message: string }> => {
    checkToolSecret(secret);
    const workflow = await ctx.runQuery(internal.workflows.getByName, { name });
    if (!workflow) {
      return { ok: false, message: `No workflow named ${name} exists.` };
    }
    if (!workflow.enabled) {
      return {
        ok: false,
        message: `The ${name} workflow is disabled in the control panel.`,
      };
    }
    await ctx.scheduler.runAfter(0, internal.workflowRunner.run, {
      name,
      params: topic ? { topic } : undefined,
    });
    await ctx.runMutation(internal.workflows.markNamedToolHealthy, {
      name: "run_workflow",
    });
    return { ok: true, message: "started" };
  },
});

// ---- One-time seed (run as admin: npx convex run workflows:seedPhase2) ----

// Search topics = open-ended discovery; feed groups = named sources with
// canonical URLs via RSS (no aggregator redirect garbage). Feed URLs
// verified live 2026-08-07; Bandcamp/FOX6/JSOnline expose no usable feeds.
const STANDING_TOPICS = [
  "AI in radio and broadcast",
  "AI and developer tooling news",
  "Bandcamp news",
  "Cooking recipes worth trying",
];

const FEED_GROUPS = [
  {
    label: "Tech headlines",
    feeds: [
      "https://techcrunch.com/feed/",
      "https://venturebeat.com/feed/",
      "https://www.producthunt.com/feed",
    ],
  },
  {
    label: "Milwaukee news",
    feeds: [
      "https://urbanmilwaukee.com/feed/",
      "https://milwaukeerecord.com/feed/",
      "https://www.tmj4.com/news/local-news.rss",
    ],
  },
  { label: "Milwaukee business", feeds: ["https://biztimes.com/feed/"] },
  { label: "Public media & funding", feeds: ["https://current.org/feed/"] },
];

const MORNING_BRIEF_STEPS: { tool: string; args: Record<string, string> }[] = [
  // GOALS leads (MOO-490): the brief opens against the telos.
  { tool: "telos_brief", args: {} },
  { tool: "get_calendar", args: { date: "{{today}}" } },
  { tool: "get_emails", args: {} },
  { tool: "get_rss", args: { feeds: "{{feedGroups}}" } },
  { tool: "web_research", args: { query: "{{topics}}" } },
];

const WEEKLY_REVIEW_STEPS: { tool: string; args: Record<string, string> }[] = [
  { tool: "telos_brief", args: {} },
  { tool: "habit_review", args: {} },
  { tool: "journal_digest", args: {} },
];


// Idempotent upsert: safe to re-run after changing steps/topics/feeds.
// Preserves the workflow's enabled toggle; overwrites steps and settings.
export const seedPhase2 = internalMutation({
  args: {},
  handler: async (ctx) => {
    async function upsertWorkflow(
      name: string,
      schedule: string,
      steps: { tool: string; args: Record<string, string> }[],
    ): Promise<string> {
      const trigger =
        schedule === "voice"
          ? ({ type: "voice" } as const)
          : ({ type: "cron", schedule } as const);
      const existing = await ctx.db
        .query("workflows")
        .withIndex("by_name", (q) => q.eq("name", name))
        .unique();
      if (!existing) {
        await ctx.db.insert("workflows", { name, trigger, steps, enabled: true });
        return `${name} seeded`;
      }
      await ctx.db.patch(existing._id, { steps });
      return `${name} updated`;
    }

    const results = [
      // 12:00 UTC = 7:00 CDT (6:00 CST in winter — Convex crons are
      // UTC-only; revisit at the DST flip if it matters).
      await upsertWorkflow("morning-brief", "0 12 * * 1-5", MORNING_BRIEF_STEPS),
      // 08:00 UTC = 3:00 AM CDT nightly.
      await upsertWorkflow("memory-consolidation", "0 8 * * *", [
        { tool: "consolidate_memories", args: {} },
      ]),
      // 14:00 UTC Sunday = 9:00 AM CDT (8:00 CST in winter).
      await upsertWorkflow("weekly-review", "0 14 * * 0", WEEKLY_REVIEW_STEPS),
      // Voice-triggered ("build me a brief on X"); schedule ignored.
      await upsertWorkflow("research-brief", "voice", [
        { tool: "web_research", args: { query: "{{topic}} — overview and latest developments" } },
        { tool: "web_research", args: { query: "{{topic}} news {{today}}" } },
        { tool: "web_research", args: { query: "{{topic}} analysis and expert commentary" } },
      ]),
    ];
    await upsertSetting(ctx, "briefTopics", STANDING_TOPICS);
    // briefFeeds is user-edited at runtime (MOO-486 feed manager) — the seed
    // must never clobber live data, only fill an empty deployment.
    await seedSettingIfAbsent(ctx, "briefFeeds", FEED_GROUPS);
    return `${results.join("; ")}; ${STANDING_TOPICS.length} search topics; ${FEED_GROUPS.length} feed groups`;
  },
});
