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
    // Routes through liveSession so the panel inherits the same staleness rule
    // as the busy guard. Returning the raw newest row meant a long-dead
    // session still drove the Viewport, and its live view is a dead socket.
    return await liveSession(ctx);
  },
});

// Brief writing for the runner — same briefs table the workflow engine
// uses; get_brief picks successes up. Failed runs are written status
// "error": they're operational logs (MOO-495) — inspectable in the archive's
// SYSTEM group, never spoken as the latest edition.
export const writeBrowseBrief = mutation({
  args: {
    secret: v.string(),
    title: v.string(),
    sections: v.array(sectionValidator),
    status: v.optional(v.union(v.literal("ready"), v.literal("error"))),
  },
  handler: async (ctx, { secret, title, sections, status }) => {
    checkToolSecret(secret);
    return await ctx.db.insert("briefs", {
      title,
      workflowName: "browse",
      status: status ?? "ready",
      runStartedAt: Date.now(),
      sections,
    });
  },
});
