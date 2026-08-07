import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
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

const STANDING_TOPICS = [
  "AI in radio and broadcast",
  "AI and developer tooling news",
  "Public radio and media funding",
  "Tech news from TechCrunch, VentureBeat, and Product Hunt",
  "Bandcamp news",
  "Cooking recipes worth trying",
  "Milwaukee news",
  "Milwaukee business news",
];

export const seedPhase2 = internalMutation({
  args: {},
  handler: async (ctx) => {
    const results: string[] = [];
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_name", (q) => q.eq("name", "morning-brief"))
      .unique();
    if (!existing) {
      await ctx.db.insert("workflows", {
        name: "morning-brief",
        // 12:00 UTC = 7:00 CDT (6:00 CST in winter — Convex crons are
        // UTC-only; revisit at the DST flip if it matters).
        trigger: { type: "cron", schedule: "0 12 * * 1-5" },
        steps: [
          { tool: "get_calendar", args: { date: "{{today}}" } },
          { tool: "get_emails", args: {} },
          { tool: "web_research", args: { query: "{{topics}}" } },
        ],
        enabled: true,
      });
      results.push("workflow morning-brief seeded");
    } else {
      results.push("workflow morning-brief already present");
    }

    const topics = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "briefTopics"))
      .unique();
    if (!topics) {
      await ctx.db.insert("settings", {
        key: "briefTopics",
        value: STANDING_TOPICS,
      });
      results.push(`briefTopics seeded (${STANDING_TOPICS.length} topics)`);
    } else {
      results.push("briefTopics already present");
    }
    return results.join("; ");
  },
});
