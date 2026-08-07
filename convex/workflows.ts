import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { requireUser } from "./dashboard";
import { checkToolSecret, markToolHealthy } from "./secondBrain";

// Workflow-engine data layer: the runner action (workflowRunner.ts) drives
// these internal functions; the public ones serve the Briefs page and the
// get_brief voice tool.

const sectionValidator = v.object({
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

export const listBriefs = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const briefs = await ctx.db.query("briefs").order("desc").take(30);
    return briefs.map(({ _id, _creationTime, title, workflowName, status }) => ({
      _id,
      _creationTime,
      title,
      workflowName,
      status,
    }));
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
    return await ctx.db
      .query("briefs")
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "ready"))
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
  { tool: "get_calendar", args: { date: "{{today}}" } },
  { tool: "get_emails", args: {} },
  { tool: "get_rss", args: { feeds: "{{feedGroups}}" } },
  { tool: "web_research", args: { query: "{{topics}}" } },
];

async function upsertSetting(
  ctx: MutationCtx,
  key: string,
  value: unknown,
): Promise<void> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row) {
    await ctx.db.patch(row._id, { value });
  } else {
    await ctx.db.insert("settings", { key, value });
  }
}

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
      const existing = await ctx.db
        .query("workflows")
        .withIndex("by_name", (q) => q.eq("name", name))
        .unique();
      if (!existing) {
        await ctx.db.insert("workflows", {
          name,
          trigger: { type: "cron", schedule },
          steps,
          enabled: true,
        });
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
    ];
    await upsertSetting(ctx, "briefTopics", STANDING_TOPICS);
    await upsertSetting(ctx, "briefFeeds", FEED_GROUPS);
    return `${results.join("; ")}; ${STANDING_TOPICS.length} search topics; ${FEED_GROUPS.length} feed groups`;
  },
});
