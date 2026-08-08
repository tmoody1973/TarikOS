import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { VOTE_LEVELS, EVIDENCE_MODES, HABIT_STATUSES } from "./habitsLib.ts";

// One declaration of the Viewport status union — table, mutations, and the
// panel's active test all derive from it.
export const browserSessionStatus = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("needs_takeover"),
  v.literal("done"),
  v.literal("error"),
);

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
    // Source article, when the card has one. Optional because cards written
    // before this field kept the URL inside `body`; the dashboard falls back
    // to finding it there (src/lib/linkify.ts) so old cards still open.
    url: v.optional(v.string()),
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

  telosItems: defineTable({
    kind: v.union(
      v.literal("mission"),
      v.literal("goal"),
      v.literal("problem"),
      v.literal("challenge"),
      v.literal("strategy"),
      v.literal("dimension"),
    ),
    text: v.string(),
    measurable: v.optional(v.string()),
    dimension: v.optional(v.string()),
    currentState: v.optional(v.string()),
    idealState: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("deferred"),
      v.literal("done"),
      v.literal("dropped"),
    ),
    reviewedAt: v.number(),
    reviewCadenceDays: v.number(),
    updatedAt: v.optional(v.number()),
    source: v.union(
      v.literal("import"),
      v.literal("interview"),
      v.literal("review"),
      v.literal("consolidation"),
    ),
    transcriptId: v.optional(v.id("transcripts")),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_kind", ["kind", "status"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
    }),

  journalEntries: defineTable({
    text: v.string(),
    mode: v.union(v.literal("capture"), v.literal("reflection")),
    consolidatedAt: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
  }).vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1024,
  }),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  // Provenance only (MOO-494): which Gmail draft ids Zola created, so /mail
  // can badge them. Draft content lives in Gmail, never here.
  zolaDrafts: defineTable({
    draftId: v.string(),
    account: v.string(),
  }).index("by_draftId", ["draftId"]),

  // Viewport (MOO-485): one row per Browserbase session; the panel is a live
  // query on the latest row. One session at a time by policy.
  browserSessions: defineTable({
    sessionId: v.string(),
    status: browserSessionStatus,
    task: v.optional(v.string()),
    liveViewUrl: v.string(),
    replayUrl: v.string(),
    briefId: v.optional(v.id("briefs")),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_sessionId", ["sessionId"]),

  habitCycles: defineTable({
    startsAt: v.number(),
    endsAt: v.number(),
    status: v.union(v.literal("active"), v.literal("closed")),
    note: v.optional(v.string()),
  }),

  habits: defineTable({
    cycleId: v.id("habitCycles"),
    pillar: v.string(),
    identity: v.string(),
    telosItemId: v.optional(v.id("telosItems")),
    minimumAction: v.string(),
    standardAction: v.string(),
    growthAction: v.optional(v.string()),
    cue: v.string(),
    habitStack: v.optional(v.string()),
    backupPlan: v.optional(v.string()),
    obvious: v.optional(v.string()),
    attractive: v.optional(v.string()),
    easy: v.optional(v.string()),
    satisfying: v.optional(v.string()),
    // Optional so existing rows and terse creates default to self_report,
    // which is the private setting.
    evidenceMode: v.optional(
      v.union(...EVIDENCE_MODES.map((m) => v.literal(m))),
    ),
    status: v.union(...HABIT_STATUSES.map((s) => v.literal(s))),
    order: v.number(),
  }).index("by_cycle", ["cycleId"]),

  habitVotes: defineTable({
    habitId: v.id("habits"),
    date: v.string(),
    level: v.union(...VOTE_LEVELS.map((l) => v.literal(l))),
    note: v.optional(v.string()),
    source: v.union(
      v.literal("voice"),
      v.literal("ui"),
      v.literal("suggestion_accepted"),
    ),
  }).index("by_habit_date", ["habitId", "date"]),

  habitSuggestions: defineTable({
    habitId: v.id("habits"),
    date: v.string(),
    reason: v.string(),
    source: v.literal("calendar"),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("dismissed"),
    ),
  }).index("by_habit_date", ["habitId", "date"]),

  habitFriction: defineTable({
    habitId: v.id("habits"),
    date: v.string(),
    text: v.string(),
    variableChanged: v.optional(v.string()),
  }).index("by_habit", ["habitId"]),
});
