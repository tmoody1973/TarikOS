// Zola's tools, as Claude sees them over a text channel.
//
// The voice agent's tool definitions live in scripts/provision-agent.ts and
// are held by the ElevenLabs runtime, which calls the /api/tools webhooks on
// its own. A text channel talks to the Anthropic API directly, so it needs the
// same tools declared in Anthropic's schema shape and its own tool-use loop.
//
// This file does NOT import provision-agent.ts, on purpose: that module throws
// at import time when TOOL_BASE_URL is unset, which would take down a route
// for a variable it has no use for. The two lists are kept honest by
// tests/textTools.test.ts, which fails if a name here stops being published.
//
// The webhook bodies are the same, so the route's tool call is a POST to
// /api/tools/<name> with the shared secret — exactly what ElevenLabs does.

export type TextTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
};

const str = (description: string) => ({ type: "string", description });

/**
 * Deliberately absent, and why. This list is as much the design as the one
 * below it, and the test asserts these stay out.
 *
 *   call_tarik      — he is already holding the phone he'd be called on
 *   navigate_ui     — there is no dashboard open in a text thread
 *   browse          — minutes-long, needs a human watching, and can ask for a
 *                     takeover that a text thread cannot deliver
 *   share_document  — the confirm gate is two calls with a spoken yes between
 *                     them; until that ritual is designed for text, sharing
 *                     stays on voice and the dashboard
 *   revoke_document_share, create_calendar_event, update_calendar_event,
 *   add_telos_item, update_telos_item
 *                   — writes whose confirmation today is prompt text. Over a
 *                     channel with no spoken confirmation they would commit on
 *                     a mis-read message.
 */
export const EXCLUDED_FROM_TEXT = [
  "call_tarik",
  "navigate_ui",
  "browse",
  "share_document",
  "revoke_document_share",
  "create_calendar_event",
  "update_calendar_event",
  "add_telos_item",
  "update_telos_item",
] as const;

export const TEXT_TOOLS: TextTool[] = [
  {
    name: "get_calendar",
    description:
      "Read Tarik's calendar. Use for anything about what is on his schedule, when he is free, or what is coming up.",
    input_schema: {
      type: "object",
      properties: {
        date: str("The day to read, as YYYY-MM-DD. Omit for today."),
      },
    },
  },
  {
    name: "get_emails",
    description:
      "Read recent email. Use for what has come in, who wrote, or whether something arrived.",
    input_schema: {
      type: "object",
      properties: {
        account: str("Which mailbox, if he named one. Omit for the default."),
      },
    },
  },
  {
    name: "recall",
    description:
      "Search Tarik's second brain — stored memories, past thoughts, and notes. Use before saying you do not know something about him.",
    input_schema: {
      type: "object",
      properties: { query: str("What to look for") },
      required: ["query"],
    },
  },
  {
    name: "remember",
    description:
      "Store a durable fact about Tarik, his preferences, projects or people.",
    input_schema: {
      type: "object",
      properties: {
        content: str("The fact, in one or two sentences"),
        type: str("One of: preference, fact, project, person"),
      },
      required: ["content", "type"],
    },
  },
  {
    name: "capture_thought",
    description:
      "Capture an idea or plan Tarik just voiced so it lands in his second brain and on his dashboard. For NEW words he just said, not for an existing record.",
    input_schema: {
      type: "object",
      properties: {
        raw: str("His words, near-verbatim"),
        cleaned: str("The same idea written clearly in 1-3 sentences"),
      },
      required: ["raw", "cleaned"],
    },
  },
  {
    name: "journal_entry",
    description:
      "Record a journal entry — a reflection or something he wants written down as part of his own record rather than as a fact to recall.",
    input_schema: {
      type: "object",
      properties: {
        text: str("The entry"),
        mode: str("One of: reflection, log"),
      },
      required: ["text"],
    },
  },
  {
    name: "web_research",
    description:
      "Search the live web for current events, news, or anything outside what you know. Returns sources. Use when one round of searching settles it.",
    input_schema: {
      type: "object",
      properties: { query: str("The research request") },
      required: ["query"],
    },
  },
  {
    name: "get_brief",
    description:
      "Read the most recent pre-built briefing. Use when he asks for his brief or what he should know today.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "find_brief",
    description:
      "Search the archive of past briefings by topic when he refers to an older one.",
    input_schema: {
      type: "object",
      properties: { query: str("What the brief was about") },
      required: ["query"],
    },
  },
  {
    name: "get_telos",
    description:
      "Read his goals, mission, problems and challenges in full, with status and deadlines.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_habits",
    description: "Read today's habits and where each one stands.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "log_habit_vote",
    description:
      "Record that he did a habit, at the level he reports. Never infer this — only log what he says.",
    input_schema: {
      type: "object",
      properties: {
        habitId: str("The habit's id, from get_habits"),
        level: str("The level he reported"),
        note: str("Anything he added about it"),
      },
      required: ["habitId", "level"],
    },
  },
  {
    name: "draft_email",
    description:
      "Write a Gmail draft. It is only ever a draft — nothing is sent, and he reviews it himself.",
    input_schema: {
      type: "object",
      properties: {
        intent: str("What the email should say and who it is to"),
        reply_match: str("If replying, a distinctive fragment of the thread"),
      },
      required: ["intent"],
    },
  },
  {
    name: "save_document",
    description:
      "Turn an existing record — the latest brief, a research query, or this week's journal digest — into a saved file. Only for existing records; for new words he just said use capture_thought or journal_entry. The file stays private to him.",
    input_schema: {
      type: "object",
      properties: {
        source_type: str("One of: brief, research, journal_digest"),
        query: str("Required when source_type is research: the thing to look up"),
      },
      required: ["source_type"],
    },
  },
];
