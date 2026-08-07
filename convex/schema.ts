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
    updatedAt: v.optional(v.number()),
    // voyage-3.5-lite, 1024 dims; absent until the backfill action embeds the row
    embedding: v.optional(v.array(v.float64())),
  })
    .searchIndex("search_content", { searchField: "content" })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
    }),

  thoughts: defineTable({
    raw: v.string(),
    cleaned: v.string(),
    tags: v.array(v.string()),
    transcriptId: v.optional(v.id("transcripts")),
    embedding: v.optional(v.array(v.float64())),
  })
    .searchIndex("search_cleaned", { searchField: "cleaned" })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
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

  workflows: defineTable({
    name: v.string(),
    trigger: v.union(
      v.object({ type: v.literal("cron"), schedule: v.string() }),
      v.object({ type: v.literal("voice") }),
    ),
    // Ordered steps; string args support {{today}}, {{topic}}, {{topics}}
    // templates ({{topics}} fans the step out into one call per standing topic).
    steps: v.array(
      v.object({ tool: v.string(), args: v.record(v.string(), v.string()) }),
    ),
    enabled: v.boolean(),
    lastRunAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_name", ["name"]),

  briefs: defineTable({
    title: v.string(),
    workflowName: v.string(),
    status: v.union(
      v.literal("building"),
      v.literal("ready"),
      v.literal("error"),
    ),
    runStartedAt: v.number(),
    sections: v.array(
      v.object({
        heading: v.string(),
        body: v.string(),
        tool: v.string(),
        updatedAt: v.number(),
        sources: v.array(v.object({ title: v.string(), url: v.string() })),
      }),
    ),
  }),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),
});
