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

  // Contacts synced one-way from Google (MOO-499). Providers own the truth;
  // nothing here is edited in TarikOS, so there is no conflict to resolve.
  //
  // `key` is the merge identity — the first normalized phone or email, or the
  // provider id when a contact has neither. Upserting on it is what makes a
  // re-sync update a person instead of duplicating them.
  //
  // `syncedAt` is the tombstone mechanism: a full sync stamps every row it
  // touches, and rows left with an older stamp were deleted upstream.
  contacts: defineTable({
    key: v.string(),
    name: v.string(),
    phones: v.array(v.string()),
    emails: v.array(v.string()),
    org: v.optional(v.string()),
    photo: v.optional(v.string()),
    sources: v.array(
      v.object({
        source: v.union(v.literal("google"), v.literal("icloud")),
        sourceId: v.string(),
      }),
    ),
    syncedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_synced", ["syncedAt"]),

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
    // The opening paragraph, written after every section is built by something
    // that read all of them. Optional because every brief already in the table
    // predates it, and because a failed writer must still leave a usable brief.
    lede: v.optional(v.string()),
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

  // A brief, research result, or journal digest turned into a stored file.
  // Bytes live in R2; only the pointer lives here. Single-user per PRODUCT.md,
  // so there is no ownerId — the same as every table above.
  documents: defineTable({
    title: v.string(),
    // "studio" is a Studio document exported to .docx. It joins this table
    // rather than getting its own, so an export inherits the share links,
    // expiry, download caps and revocation that already live here — one
    // canonical store for "an artifact I can hand to someone".
    sourceType: v.union(
      v.literal("brief"),
      v.literal("research"),
      v.literal("journal_digest"),
      v.literal("studio"),
    ),
    sourceId: v.optional(v.string()),
    objectKey: v.string(),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    createdAt: v.number(),
  }).index("by_sourceType", ["sourceType", "createdAt"]),

  // The row that fronts a presigned R2 URL. `/f/<slug>` is exempt from Clerk,
  // so there is no session on that route: this row IS the access control.
  // Never store or expose a raw R2 URL — one is minted per visit, short-lived,
  // after the checks in documentsLib pass.
  documentShareLinks: defineTable({
    documentId: v.id("documents"),
    slug: v.string(),
    expiresAt: v.optional(v.number()),
    maxDownloads: v.optional(v.number()),
    downloadCount: v.number(),
    revoked: v.boolean(),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  // The confirm gate's memory. share_document is two calls — one to ask, one
  // to act — and on Vercel those are separate invocations with no shared
  // process, so the token between them has to be persisted rather than held.
  //
  // The design assumed a confirm ritual already existed in the tool route. It
  // did not: what existed was prompt text asking the agent to say a sentence
  // first. This table is what makes the gate structural instead.
  //
  // ponytail: tokens are stored as issued, not hashed. Single-user app,
  // single-use tokens, five-minute TTL — hash them if this ever grows a
  // second reader of the table.
  // Text-channel conversation history (Telegram). Kept so "what about
  // tomorrow?" has something to refer to; windowed by convex/telegramLib.ts
  // rather than by a TTL, because a gap between messages ends a conversation
  // and the age of the first message does not.
  //
  // ponytail: no per-chat index — this is one user and one chat. Add
  // by_chat if a second ever exists.
  telegramTurns: defineTable({
    chatId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_chat_time", ["chatId", "createdAt"]),

  documentShareConfirmations: defineTable({
    token: v.string(),
    documentId: v.id("documents"),
    expiresAt: v.number(),
    used: v.boolean(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  // Studio. Deliberately NOT `documents` — that table is already taken by the
  // saved R2 files behind /documents and their share links, and two things
  // called a document in one schema is a bug waiting for a tired evening.
  //
  // `content` is the editor's own JSON tree, stringified. Not markdown, not
  // HTML: those are lossy exports of this, and every editor evaluated says so
  // in its own API. Stringified rather than a nested validator because the tree
  // is arbitrary depth by nature, and a schema that has to describe every node
  // type would have to change every time a new block ships.
  studioDocs: defineTable({
    title: v.string(),
    docType: v.union(
      v.literal("note"),
      v.literal("draft"),
      v.literal("brief"),
      v.literal("plan"),
      v.literal("decision"),
    ),
    content: v.string(),
    // How many times this document has changed. Every write carries the
    // revision it was written from, and one that no longer matches is refused.
    // Without it a slow save silently overwrites a newer one — one person, one
    // tab, no collaboration required — and the screen still shows the text that
    // was just deleted.
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
    // voyage-3.5-lite, 1024 dims, same as memories and thoughts — absent until
    // the backfill embeds the row.
    embedding: v.optional(v.array(v.float64())),
    // WHICH revision that embedding was made from. Not a boolean "embedded"
    // flag: a document is edited for weeks, and a flag cannot tell an embedding
    // of today's text from an embedding of last Tuesday's. Behind the counter
    // means stale, which is the only question the backfill asks.
    embeddedRevision: v.optional(v.number()),
  })
    .index("by_updated", ["updatedAt"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
    }),

  // A promise to interrupt him later.
  //
  // A ROW, not just a scheduled function. `scheduler.runAt` alone would be
  // invisible: nothing could list what is pending, and nothing could call one
  // off. The row is also what makes cancellation real — the scheduled fire
  // still runs at the appointed time and finds a status that is no longer
  // pending, which is more reliable than trying to unschedule it.
  reminders: defineTable({
    text: v.string(),
    dueAt: v.number(),
    channel: v.union(v.literal("telegram"), v.literal("email")),
    status: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    // Kept rather than logged. A reminder that failed silently is the same as
    // a reminder that was never set, and he would only find out by missing it.
    error: v.optional(v.string()),
  }).index("by_status_due", ["status", "dueAt"]),

  // A rewrite waiting for Tarik to look at it.
  //
  // The same object whether it came from the screen or from Zola's voice, so
  // there is ONE review panel. Voice cannot show a diff, so voice must not
  // write: she proposes, the screen decides. That is not a limitation being
  // engineered around — it is what makes it safe to let her near his writing.
  //
  // `original` is what the block said WHEN THE PROPOSAL WAS MADE, and it is the
  // load-bearing field. By the time it is accepted the document may have moved
  // under it, and a proposal applied to a paragraph that has since been
  // rewritten by hand silently deletes the rewrite.
  studioProposals: defineTable({
    docId: v.id("studioDocs"),
    blockIndex: v.number(),
    original: v.string(),
    proposed: v.string(),
    instruction: v.string(),
    origin: v.union(v.literal("voice"), v.literal("screen")),
    status: v.union(
      v.literal("pending"),
      v.literal("applied"),
      v.literal("rejected"),
    ),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_doc_status", ["docId", "status", "createdAt"]),

  // What a Studio document points at. A reference, never a copy: the type and
  // the record's own id, plus a label snapshotted for display so a chip still
  // reads as something after the record behind it is gone.
  //
  // `label` is a display snapshot and may drift from the record's current
  // title. That is deliberate — resolving six tables to render a list would
  // make every document open at the speed of its slowest source.
  studioRefs: defineTable({
    docId: v.id("studioDocs"),
    sourceType: v.union(
      v.literal("brief"),
      v.literal("conversation"),
      v.literal("telos"),
      v.literal("contact"),
      v.literal("thought"),
      v.literal("document"),
      v.literal("url"),
      // A Studio document can ground another one — the most obvious thing a
      // writing workspace should do, and the thing it could not do until now.
      v.literal("studio"),
    ),
    sourceId: v.string(),
    label: v.string(),
    createdAt: v.number(),
  }).index("by_doc", ["docId", "createdAt"]),

  // A snapshot of one document at one moment. Separate from the revision
  // counter and doing a different job: the counter prevents a lost update, the
  // snapshots are the way back to last Tuesday.
  studioVersions: defineTable({
    docId: v.id("studioDocs"),
    title: v.string(),
    content: v.string(),
    revision: v.number(),
    label: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_doc", ["docId", "createdAt"]),

  // One row per message accepted into Zola's own inbox.
  //
  // The body is NOT copied — AgentMail owns it and it is fetched on demand.
  // What this table is really for is the two things a webhook needs and a poll
  // cannot give: idempotency on the message id, because a delivery can arrive
  // twice, and a record of who has already had the one automatic reply,
  // because once per SENDER is the whole loop protection.
  zolaMail: defineTable({
    messageId: v.string(),
    threadId: v.optional(v.string()),
    from: v.string(),
    subject: v.string(),
    summary: v.string(),
    receivedAt: v.number(),
    autoRepliedAt: v.optional(v.number()),
    // Why she did not write back, kept so a silent inbox can be explained.
    autoReplySkipped: v.optional(v.string()),
  })
    .index("by_message", ["messageId"])
    .index("by_sender", ["from"])
    .index("by_received", ["receivedAt"]),

  // ---------------------------------------------------------------- second brain v1
  //
  // Two stores, and only two. Everything else the second brain shows is a
  // POINTER at a row that already exists somewhere in this file — a memory, a
  // habit, a document, a telos item — inheriting its kind from what it points
  // at. Nobody picks a type at capture time, which is why capture can ask
  // nothing. Decided 2026-08-21; the reasoning is in
  // docs/decisions/2026-08-21-second-brain-that-survives.md.

  // What was chosen, and why.
  //
  // The one genuine gap in the system: nothing here stores a decision. A memory
  // holds what is true, a telos item holds what he is aiming at, a thought
  // holds what occurred to him. None of them hold "we went with X, because Y,
  // and it replaced Z" — which is the shape of the question he actually asks.
  //
  // `supersedes` is the load-bearing field. Without it this is a log; with it,
  // asking "what did we decide about X" can answer with the CURRENT decision
  // and say what it overruled, which is the difference between a record and an
  // archive.
  decisions: defineTable({
    what: v.string(),
    // Written from what he just said, then read back once for a yes. Never
    // solicited with a question — see the capture rule in the decision doc.
    why: v.string(),
    decidedAt: v.number(),
    supersedes: v.optional(v.id("decisions")),
    // Provenance. Derived facts may be spoken as fact only because the
    // conversation they came from can be pointed at.
    transcriptId: v.optional(v.id("transcripts")),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_decidedAt", ["decidedAt"])
    .searchIndex("search_what", { searchField: "what" })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
    }),

  // Something unresolved, with no date and no email.
  //
  // The hole between `reminders` (which needs a dueAt) and reply_zero (which
  // only ever sees mail). Most of what is actually hanging over him is neither:
  // a thing he said he would do, with nobody chasing it and no calendar entry.
  //
  // `person` and `dueAt` are optional and are NEVER prompted for. If the
  // sentence he said contains them, they are filled in; if not, the loop is
  // still worth having. A store that demands a due date before it will accept
  // an item is a store he stops using by week three.
  openLoops: defineTable({
    text: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    person: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    transcriptId: v.optional(v.id("transcripts")),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_status", ["status"])
    .searchIndex("search_text", { searchField: "text" })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
    }),
});
