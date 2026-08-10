import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { checkToolSecret } from "./secondBrain";
import {
  MAX_CONTEXT_TURNS,
  selectContextTurns,
  trimTurn,
} from "./telegramLib.ts";

// Conversation history for the text channel (MOO-497, Telegram).
//
// Secret-gated rather than user-gated: the caller is a webhook with no Clerk
// session, exactly like the tool routes.

/** The turns belonging to the conversation happening right now, oldest first. */
export const context = query({
  args: { secret: v.string(), chatId: v.string() },
  handler: async (ctx, { secret, chatId }) => {
    checkToolSecret(secret);
    // Twice the window, so the gap rule has older turns to rule out rather
    // than a truncated view that hides the silence.
    const rows = await ctx.db
      .query("telegramTurns")
      .withIndex("by_chat_time", (q) => q.eq("chatId", chatId))
      .order("desc")
      .take(MAX_CONTEXT_TURNS * 2);
    return selectContextTurns(
      rows.map((r) => ({ role: r.role, content: r.content, createdAt: r.createdAt })),
      Date.now(),
    );
  },
});

/** Record one turn. Written after the reply, so a failed answer leaves no trace. */
export const appendTurn = mutation({
  args: {
    secret: v.string(),
    chatId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  handler: async (ctx, { secret, chatId, role, content }) => {
    checkToolSecret(secret);
    const text = trimTurn(content);
    if (!text) return { stored: false };
    await ctx.db.insert("telegramTurns", {
      chatId,
      role,
      content: text,
      createdAt: Date.now(),
    });
    return { stored: true };
  },
});
