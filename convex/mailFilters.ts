import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret } from "./secondBrain";
import { requireUser } from "./dashboard";
import { readSetting, upsertSetting } from "./settingsLib.ts";
import type { MuteList } from "./mailFilterLib.ts";

// Which senders and subjects never reach the inbox panel, the morning brief,
// or Zola.
//
// Kept as a SETTING rather than in code, because the next robot to start
// mailing Tarik should cost him a line in the control panel, not a deploy.

const KEY = "mailMutes";

const EMPTY: MuteList = { senders: [], subjects: [] };

/** Bounded so a paste into the control panel cannot blow the setting up. */
const MAX_RULES = 100;
const MAX_RULE_CHARS = 200;

function sanitize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, MAX_RULE_CHARS))
    .filter(Boolean)
    .slice(0, MAX_RULES);
}

async function read(ctx: Parameters<typeof readSetting>[0]): Promise<MuteList> {
  const stored = await readSetting<MuteList>(ctx, KEY);
  if (!stored) return EMPTY;
  return { senders: sanitize(stored.senders), subjects: sanitize(stored.subjects) };
}

/**
 * For the mail fetch, which runs in Next with the tool secret rather than a
 * browser session — the same path Zola's tools take.
 */
export const forTools = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    return await read(ctx);
  },
});

/** For the control panel, which has a Clerk session. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await read(ctx);
  },
});

export const save = mutation({
  args: {
    senders: v.array(v.string()),
    subjects: v.array(v.string()),
  },
  handler: async (ctx, { senders, subjects }) => {
    await requireUser(ctx);
    const next: MuteList = { senders: sanitize(senders), subjects: sanitize(subjects) };
    await upsertSetting(ctx, KEY, next);
    return next;
  },
});
