"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { TOOL_BASE_URL } from "./workflowLib";

// Firing a reminder.
//
// Delivery happens in NEXT, not here: Convex holds none of the credentials the
// channels need (Telegram's bot token, Resend's key, the ElevenLabs phone
// settings), and duplicating them into a second environment would mean two
// places to rotate. So this calls back into the tool route the same way the
// workflow runner does, using the tool that only the SYSTEM calls.
//
// The scheduled fire always runs. Cancelling does not try to unschedule it —
// it sets the row's status, and this refuses anything that is no longer
// pending. One source of truth, and no window where a cancel races a fire.

export const fire = internalAction({
  args: { id: v.id("reminders") },
  handler: async (ctx, { id }): Promise<void> => {
    const reminder = await ctx.runQuery(internal.remindersDb.claim, { id });
    // Cancelled, already sent, or gone. Nothing to do and nothing wrong.
    if (!reminder) return;

    const secret = process.env.MORPHEUS_TOOL_SECRET;
    if (!secret) {
      await ctx.runMutation(internal.remindersDb.resolve, {
        id,
        status: "failed",
        error: "MORPHEUS_TOOL_SECRET is not set in Convex",
      });
      return;
    }

    try {
      const res = await fetch(`${TOOL_BASE_URL}/deliver_reminder`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-morpheus-secret": secret },
        body: JSON.stringify({ text: reminder.text, channel: reminder.channel }),
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      await ctx.runMutation(internal.remindersDb.resolve, {
        id,
        status: json?.ok ? "sent" : "failed",
        error: json?.ok ? undefined : (json?.message ?? `HTTP ${res.status}`),
      });
    } catch (error) {
      await ctx.runMutation(internal.remindersDb.resolve, {
        id,
        status: "failed",
        error: error instanceof Error ? error.message : "delivery threw",
      });
    }
  },
});
