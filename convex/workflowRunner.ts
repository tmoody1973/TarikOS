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

/**
 * Briefs that get texted when they finish.
 *
 * Only the ones a cron builds while he is asleep. memory-consolidation is not
 * a brief anyone reads, and the weekly review lands on a Sunday morning he is
 * already at a screen for — add it here if that turns out to be wrong.
 */
const DIGEST_WORKFLOWS = new Set(["morning-brief"]);

async function callTool(
  tool: string,
  args: Record<string, unknown>,
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

    const title = params?.topic
      ? `Research: ${params.topic} — ${today}`
      : workflowTitle(name, today);
    const id = await ctx.runMutation(internal.workflows.createOrResetBrief, {
      briefId,
      title,
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
    const built: { heading: string; body: string }[] = [];
    for (const step of steps) {
      const result = await callTool(step.tool, step.args, secret);
      const { section, isError } = formatSection(step, result);
      if (isError) {
        firstError = firstError ?? `${step.label}: ${result.message}`;
      } else {
        okCount++;
      }
      built.push({ heading: section.heading, body: section.body });
      await ctx.runMutation(internal.workflows.appendSection, {
        briefId: id,
        section: { ...section, updatedAt: Date.now() },
      });
    }

    const ready = okCount > 0;
    await ctx.runMutation(internal.workflows.finishBrief, {
      briefId: id,
      status: ready ? "ready" : "error",
      workflowName: name,
      error: firstError,
    });

    // Put the finished brief on his phone. Sections are passed straight from
    // memory rather than read back, because every tool route is secret-gated
    // and none of them can reach a Clerk-authenticated brief query.
    //
    // Only the brief a cron builds before he is awake — a brief he triggered
    // himself from the Briefs page is already on the screen he triggered it
    // from, and texting it back is noise. DIGEST_WORKFLOWS is the whole
    // policy; the on/off switch is the send_brief_digest tool's own toggle in
    // the control panel.
    if (ready && DIGEST_WORKFLOWS.has(name)) {
      // Deliberately not awaited into the run's success: a Telegram outage
      // must not mark a brief that built fine as a failed run.
      const digest = await callTool(
        "send_brief_digest",
        { title, sections: built },
        secret,
      );
      if (!digest.ok) console.log(`brief digest not sent: ${digest.message}`);
    }
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
