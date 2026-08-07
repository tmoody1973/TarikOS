"use node";

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  TOOL_BASE_URL,
  chicagoToday,
  expandSteps,
  formatSection,
  workflowTitle,
  type ToolResult,
} from "./workflowLib";

const WATCHDOG_MS = 5 * 60 * 1000;

async function callTool(
  tool: string,
  args: Record<string, string>,
  secret: string,
): Promise<ToolResult> {
  try {
    const res = await fetch(`${TOOL_BASE_URL}/${tool}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-morpheus-secret": secret,
      },
      body: JSON.stringify(args),
    });
    const json = (await res.json()) as ToolResult;
    if (typeof json?.ok !== "boolean") {
      return { ok: false, message: `Tool ${tool} returned an unexpected response` };
    }
    return json;
  } catch (error) {
    return {
      ok: false,
      message: `Tool ${tool} call failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// The workflow runner: walks a workflow's steps through the existing
// /api/tools/* routes and patches the brief section-by-section so an open
// Briefs page repopulates live mid-build. Failed steps become error
// sections and the run continues — a partial brief beats no brief.
export const run = internalAction({
  args: {
    name: v.string(),
    params: v.optional(v.object({ topic: v.optional(v.string()) })),
    briefId: v.optional(v.id("briefs")),
  },
  handler: async (ctx, { name, params, briefId }) => {
    const secret = process.env.MORPHEUS_TOOL_SECRET;
    if (!secret) throw new Error("MORPHEUS_TOOL_SECRET not set in Convex env");

    const workflow = await ctx.runQuery(internal.workflows.getByName, { name });
    if (!workflow) {
      // Unseeded deployment (e.g. dev) — the cron fires everywhere, so stay quiet.
      console.log(`Workflow ${name} not seeded on this deployment; skipping`);
      return;
    }
    if (!workflow.enabled) {
      console.log(`Workflow ${name} is disabled; skipping run`);
      return;
    }

    const topics =
      ((await ctx.runQuery(internal.workflows.getSetting, {
        key: "briefTopics",
      })) as string[] | null) ?? [];
    const feedGroups =
      ((await ctx.runQuery(internal.workflows.getSetting, {
        key: "briefFeeds",
      })) as { label: string; feeds: string[] }[] | null) ?? [];
    const today = chicagoToday();
    const runStartedAt = Date.now();

    const id = await ctx.runMutation(internal.workflows.createOrResetBrief, {
      briefId,
      title: workflowTitle(name, today),
      workflowName: name,
      runStartedAt,
    });
    await ctx.scheduler.runAfter(WATCHDOG_MS, internal.workflows.watchdog, {
      briefId: id,
      runStartedAt,
    });

    const steps = expandSteps(workflow.steps, {
      today,
      topics,
      topic: params?.topic,
      feedGroups,
    });

    let okCount = 0;
    let firstError: string | undefined;
    for (const step of steps) {
      const result = await callTool(step.tool, step.args, secret);
      const { section, isError } = formatSection(step, result);
      if (isError) {
        firstError = firstError ?? `${step.label}: ${result.message}`;
      } else {
        okCount++;
      }
      await ctx.runMutation(internal.workflows.appendSection, {
        briefId: id,
        section: { ...section, updatedAt: Date.now() },
      });
    }

    await ctx.runMutation(internal.workflows.finishBrief, {
      briefId: id,
      status: okCount > 0 ? "ready" : "error",
      workflowName: name,
      error: firstError,
    });
  },
});

// Browser-facing trigger (Briefs page Refresh button). Fire-and-return: the
// build itself runs scheduled, so the UI gets an immediate ack and watches
// the brief repopulate via its live query.
export const runNow = action({
  args: { name: v.string(), briefId: v.optional(v.id("briefs")) },
  handler: async (ctx, { name, briefId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    await ctx.scheduler.runAfter(0, internal.workflowRunner.run, {
      name,
      briefId,
    });
  },
});
