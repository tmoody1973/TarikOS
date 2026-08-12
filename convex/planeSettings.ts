import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret } from "./secondBrain";
import { requireUser } from "./dashboard";
import { readSetting, upsertSetting } from "./settingsLib.ts";

// Where a quick todo goes when Tarik does not name a project.
//
// A SETTING rather than a constant, for the reason the mail mutes are one: the
// next time he wants his todos somewhere else, it should cost him a line in the
// control panel instead of a deploy.
//
// This is the ONLY Plane state Tarik OS stores. Projects and work items live in
// Plane and are read live — there is no mirror here to drift, deliberately.
// See docs/superpowers/specs/2026-08-11-tarik-os-plane-projects-design.md.

const KEY = "planeDefaultProject";

export type PlaneDefault = { projectId: string; projectName: string };

const EMPTY: PlaneDefault = { projectId: "", projectName: "" };

function sanitize(stored: unknown): PlaneDefault {
  const value = (stored ?? {}) as Partial<PlaneDefault>;
  return {
    projectId: typeof value.projectId === "string" ? value.projectId : "",
    projectName: typeof value.projectName === "string" ? value.projectName : "",
  };
}

/** For Zola's tools, which arrive with the shared secret rather than a session. */
export const forTools = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    checkToolSecret(secret);
    return sanitize(await readSetting<PlaneDefault>(ctx, KEY)) ?? EMPTY;
  },
});

/** For the control panel and the board, which have a Clerk session. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return sanitize(await readSetting<PlaneDefault>(ctx, KEY)) ?? EMPTY;
  },
});

/**
 * Point quick todos at a different project.
 *
 * The NAME is stored beside the id, not resolved on read. Resolving it would
 * make the control panel wait on Plane to render one line, and a stale label is
 * a smaller problem than a settings page that fails when a provider is slow.
 */
export const set = mutation({
  args: { projectId: v.string(), projectName: v.string() },
  handler: async (ctx, { projectId, projectName }) => {
    await requireUser(ctx);
    await upsertSetting(ctx, KEY, {
      projectId: projectId.trim(),
      projectName: projectName.trim().slice(0, 120),
    });
    return { ok: true as const };
  },
});
