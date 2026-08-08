import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { checkToolSecret } from "./secondBrain";
import { requireUser } from "./dashboard";
import { readSetting, upsertSetting } from "./settingsLib";

// Feed manager (MOO-486): CRUD over the `briefFeeds` setting the morning
// brief already reads — the engine never changes, only the data. Two auth
// paths: Clerk identity (Control Panel) and tool secret (Zola's webhook).

export type FeedGroup = { label: string; feeds: string[] };
export type FeedHealth = Record<string, { ok: boolean; at: number; error?: string }>;

const readGroups = (ctx: QueryCtx | MutationCtx) =>
  readSetting<FeedGroup[]>(ctx, "briefFeeds").then((g) => g ?? []);

function findGroup(groups: FeedGroup[], label: string): FeedGroup | undefined {
  const needle = label.trim().toLowerCase();
  return (
    groups.find((g) => g.label.toLowerCase() === needle) ??
    groups.find((g) => g.label.toLowerCase().includes(needle))
  );
}

// Pure add: dedupes across all groups; creates the group when it's new.
function withFeedAdded(
  groups: FeedGroup[],
  groupLabel: string,
  feedUrl: string,
): { groups: FeedGroup[]; group: string; existing?: string } {
  const already = groups.find((g) => g.feeds.includes(feedUrl));
  if (already) return { groups, group: already.label, existing: already.label };
  const target = findGroup(groups, groupLabel);
  if (!target) {
    return {
      groups: [...groups, { label: groupLabel.trim(), feeds: [feedUrl] }],
      group: groupLabel.trim(),
    };
  }
  return {
    groups: groups.map((g) =>
      g.label === target.label ? { ...g, feeds: [...g.feeds, feedUrl] } : g,
    ),
    group: target.label,
  };
}

function withFeedRemoved(groups: FeedGroup[], feedUrl: string): FeedGroup[] {
  return groups.map((g) => ({
    ...g,
    feeds: g.feeds.filter((f) => f !== feedUrl),
  }));
}

// ---- Control Panel (identity-gated) ----

export const feedGroups = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const [groups, health] = await Promise.all([
      readGroups(ctx),
      readSetting<FeedHealth>(ctx, "feedHealth"),
    ]);
    return { groups, health: health ?? {} };
  },
});

export const addFeed = mutation({
  args: { group: v.string(), feedUrl: v.string() },
  handler: async (ctx, { group, feedUrl }) => {
    await requireUser(ctx);
    const result = withFeedAdded(await readGroups(ctx), group, feedUrl);
    await upsertSetting(ctx, "briefFeeds", result.groups);
    return result.existing
      ? `Already in ${result.existing}`
      : `Added to ${result.group}`;
  },
});

export const removeFeed = mutation({
  args: { feedUrl: v.string() },
  handler: async (ctx, { feedUrl }) => {
    await requireUser(ctx);
    await upsertSetting(ctx, "briefFeeds", withFeedRemoved(await readGroups(ctx), feedUrl));
  },
});

export const moveFeed = mutation({
  args: { feedUrl: v.string(), toGroup: v.string() },
  handler: async (ctx, { feedUrl, toGroup }) => {
    await requireUser(ctx);
    const groups = withFeedRemoved(await readGroups(ctx), feedUrl);
    await upsertSetting(ctx, "briefFeeds", withFeedAdded(groups, toGroup, feedUrl).groups);
  },
});

export const addGroup = mutation({
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    await requireUser(ctx);
    const groups = await readGroups(ctx);
    if (!label.trim() || findGroup(groups, label)) return;
    await upsertSetting(ctx, "briefFeeds", [...groups, { label: label.trim(), feeds: [] }]);
  },
});

export const renameGroup = mutation({
  args: { label: v.string(), newLabel: v.string() },
  handler: async (ctx, { label, newLabel }) => {
    await requireUser(ctx);
    if (!newLabel.trim()) return;
    const groups = await readGroups(ctx);
    await upsertSetting(
      ctx,
      "briefFeeds",
      groups.map((g) => (g.label === label ? { ...g, label: newLabel.trim() } : g)),
    );
  },
});

export const removeGroup = mutation({
  args: { label: v.string() },
  handler: async (ctx, { label }) => {
    await requireUser(ctx);
    const groups = await readGroups(ctx);
    const target = groups.find((g) => g.label === label);
    if (!target || target.feeds.length > 0) return; // only empty groups
    await upsertSetting(ctx, "briefFeeds", groups.filter((g) => g.label !== label));
  },
});

// ---- Zola's webhook (secret-gated) ----

export const manageFeedsFromTool = mutation({
  args: {
    secret: v.string(),
    action: v.union(v.literal("add"), v.literal("remove")),
    feedUrl: v.optional(v.string()),
    group: v.optional(v.string()),
    match: v.optional(v.string()),
  },
  handler: async (ctx, { secret, action, feedUrl, group, match }) => {
    checkToolSecret(secret);
    const groups = await readGroups(ctx);
    if (action === "add") {
      if (!feedUrl || !group) throw new Error("add needs feedUrl and group");
      const result = withFeedAdded(groups, group, feedUrl);
      await upsertSetting(ctx, "briefFeeds", result.groups);
      return { outcome: result.existing ? "existing" : "added", group: result.group };
    }
    // remove: substring match against feed URLs; ambiguity removes nothing.
    const needle = (match ?? "").trim().toLowerCase();
    if (!needle) throw new Error("remove needs a match");
    const hits = groups.flatMap((g) =>
      g.feeds.filter((f) => f.toLowerCase().includes(needle)).map((f) => ({ url: f, group: g.label })),
    );
    if (hits.length === 0) return { outcome: "none" };
    if (hits.length > 1) return { outcome: "ambiguous", candidates: hits.slice(0, 4) };
    await upsertSetting(ctx, "briefFeeds", withFeedRemoved(groups, hits[0].url));
    return { outcome: "removed", url: hits[0].url, group: hits[0].group };
  },
});

export const listFeedsFromTool = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    return readGroups(ctx);
  },
});

export const reportFeedHealth = mutation({
  args: {
    secret: v.string(),
    entries: v.array(
      v.object({ url: v.string(), ok: v.boolean(), error: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, { secret, entries }) => {
    checkToolSecret(secret);
    const health = (await readSetting<FeedHealth>(ctx, "feedHealth")) ?? {};
    const at = Date.now();
    const updated = {
      ...health,
      ...Object.fromEntries(
        entries.map((e) => [
          e.url,
          { ok: e.ok, at, ...(e.error ? { error: e.error } : {}) },
        ]),
      ),
    };
    await upsertSetting(ctx, "feedHealth", updated);
  },
});
