import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  memories: defineTable({
    content: v.string(),
    type: v.union(
      v.literal("preference"),
      v.literal("fact"),
      v.literal("project"),
      v.literal("person"),
    ),
    transcriptId: v.optional(v.id("transcripts")),
  }),

  thoughts: defineTable({
    raw: v.string(),
    cleaned: v.string(),
    tags: v.array(v.string()),
    transcriptId: v.optional(v.id("transcripts")),
  }),

  transcripts: defineTable({
    title: v.string(),
    turns: v.array(
      v.object({
        role: v.union(v.literal("tarik"), v.literal("morpheus")),
        text: v.string(),
        at: v.number(),
      }),
    ),
    toolCalls: v.array(
      v.object({
        tool: v.string(),
        status: v.union(v.literal("ok"), v.literal("error")),
        at: v.number(),
      }),
    ),
  }),

  tools: defineTable({
    name: v.string(),
    description: v.string(),
    enabled: v.boolean(),
    health: v.union(v.literal("ok"), v.literal("error"), v.literal("unknown")),
    lastError: v.optional(v.string()),
  }).index("by_name", ["name"]),

  briefingCards: defineTable({
    kind: v.union(
      v.literal("calendar"),
      v.literal("email"),
      v.literal("research"),
      v.literal("note"),
    ),
    title: v.string(),
    body: v.string(),
  }),
});
