import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { checkToolSecret } from "./secondBrain";
import { requireUser } from "./dashboard";
import { browserSessionStatus } from "./schema";
import { sectionValidator } from "./workflows";

// Viewport state (MOO-485). Browserbase/Stagehand live in the Next server;
// Convex holds only session rows and the brief the runner writes into.
// Secret path = tool webhook + runner; identity path = the panel.

// A row past this age counts as dead even if no terminal status landed
// (killed runner, abandoned manual session) — Browserbase has released the
// real session server-side long before this. Keeps the busy guard from
// wedging shut forever.
const STALE_MS = 30 * 60 * 1000;

async function liveSession(ctx: QueryCtx) {
  const latest = await ctx.db.query("browserSessions").order("desc").first();
  const active =
    latest &&
    latest.status !== "done" &&
    latest.status !== "error" &&
    Date.now() - latest.updatedAt < STALE_MS;
  return active ? latest : null;
}

// Atomic one-at-a-time guard: the insert IS the check (Convex mutations are
// serializable). Callers catch "busy", release their Browserbase session,
// and speak the busy message.
export const startSession = mutation({
  args: {
    secret: v.string(),
    sessionId: v.string(),
    status: browserSessionStatus,
    task: v.optional(v.string()),
    liveViewUrl: v.string(),
    replayUrl: v.string(),
  },
  handler: async (ctx, { secret, ...row }) => {
    checkToolSecret(secret);
    if (await liveSession(ctx)) throw new ConvexError("busy");
    return await ctx.db.insert("browserSessions", {
      ...row,
      updatedAt: Date.now(),
    });
  },
});

export const updateSession = mutation({
  args: {
    secret: v.string(),
    sessionId: v.string(),
    status: v.optional(browserSessionStatus),
    briefId: v.optional(v.id("briefs")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { secret, sessionId, ...patch }) => {
    checkToolSecret(secret);
    const row = await ctx.db
      .query("browserSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
  },
});

// The panel's live view (identity-gated).
export const latestSession = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("browserSessions").order("desc").first();
  },
});

// Brief writing for the runner — same briefs table the workflow engine uses;
// get_brief picks the result up (latestReadyBrief has no workflowName
// filter). Failed runs are written "ready" too, with the failure explained
// in the section body, so Zola can speak them instead of going silent.
export const writeBrowseBrief = mutation({
  args: {
    secret: v.string(),
    title: v.string(),
    sections: v.array(sectionValidator),
  },
  handler: async (ctx, { secret, title, sections }) => {
    checkToolSecret(secret);
    return await ctx.db.insert("briefs", {
      title,
      workflowName: "browse",
      status: "ready",
      runStartedAt: Date.now(),
      sections,
    });
  },
});
