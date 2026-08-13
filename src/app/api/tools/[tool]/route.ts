import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import {
  createCalendarEvent,
  getCalendarEvents,
  getRecentEmails,
  updateCalendarEventByMatch,
  GoogleAuthError,
} from "@/lib/google";
import { isValidDate, isValidTime } from "@/lib/calendarLib";
import { chicagoToday } from "../../../../../convex/workflowLib";
import {
  composioResearch,
  agentkeyResearch,
  type ResearchResult,
} from "@/lib/research";
import { fetchFeedGroup } from "@/lib/rss";
import { runConsolidation } from "@/lib/consolidate";
import { createDraft, resolveReplyTarget } from "@/lib/mail";
import { draftEmailBody } from "@/lib/zolaDraft";
import { discoverFeed } from "@/lib/feedDiscovery";
import { createBrowserSession, endBrowserSession } from "@/lib/browserSession";
import { briefKind, rankBriefs, chicagoDateTime } from "@/lib/briefArchive";
import { safeSlice } from "../../../../../convex/workflowLib";
import {
  TELOS_KINDS,
  TELOS_STATUSES,
  buildGoalsSection,
  buildJournalDigest,
  type TelosKind,
  type TelosStatus,
} from "../../../../../convex/telosLib";
import { buildHabitReview } from "../../../../../convex/habitsLib";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { classifyOutcome, type ToolOutcome } from "@/lib/toolOutcome";
import { uploadBuffer } from "@/lib/r2";
import { escapeHtml, notifyOwner } from "@/lib/telegram";
import { briefDigest } from "@/lib/briefDigest";
import { proposeRewrite } from "@/lib/studioPropose";
import {
  AgentMailError,
  createReplyDraft,
  emailOwner,
  listMessages,
} from "@/lib/agentmail";
import {
  countInbox,
  describeInbox,
  inboxAllowlist,
  pickReplyTarget,
  received,
  summarize,
} from "@/lib/agentmailLib";
import {
  askedForACall,
  channelOf,
  describeReminders,
  matchReminders,
  reminderAt,
  spokenTime,
} from "../../../../../convex/remindersLib";
import { DOC_TYPES } from "../../../../../convex/studioLib";
import {
  createProject,
  createWorkItem,
  listProjects,
  listStates,
  listWorkItems,
  updateWorkItem,
  PlaneError,
} from "@/lib/plane";
import {
  describeStatus,
  isConfirmed,
  projectIdentifier,
  rankProjects,
  workItemPayload,
} from "@/lib/planeLib";
import {
  createGoogleContact,
  deleteGoogleContact,
  fetchGooglePeople,
  getGoogleContact,
  updateGoogleContact,
} from "@/lib/googlePeople";
import {
  buildPersonPayload,
  buildUpdatePayload,
  contactKey,
  googlePeopleToContacts,
  mergeContacts,
  type CurrentPerson,
} from "../../../../../convex/contactsLib";
import {
  buildDocumentFromBrief,
  buildDocumentFromJournal,
  buildDocumentFromResearch,
  objectKeyFor,
  shareExpiryFrom,
} from "@/lib/documentBuilders";
import { getTracer, safeSetAttrs, safeEndSpan } from "@/lib/tracing";
import { LEDE_BRIEF, LENS, ledeInput, trimLede, MAX_LEDE_CHARS } from "@/lib/lede";

// Webhook endpoint for Zola's ElevenLabs server tools. Authenticated by
// a shared secret header (configured on the agent), not a browser session —
// proxy.ts exempts /api/tools from Clerk.
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// The lede writer's model, hoisted the way consolidate.ts, studioPropose.ts,
// and zolaDraft.ts already do it — one named constant instead of a literal
// buried in a request body.
const MODEL = "claude-opus-5";

// Rows per contact mutation. A full sync is ~4,800 and one mutation cannot
// carry them; this also bounds each stale-sweep pass.
const CONTACT_BATCH = 200;
// Enough passes to clear a full book, so a purge cannot silently half-finish.
const MAX_SWEEP_PASSES = 40;

// `outcome` is telemetry only — it records what actually happened, which `ok`
// cannot, because several sites answer `ok: true` with a non-result so Zola
// speaks a helpful sentence instead of an error. It is stripped before the
// response is serialized; the agent never sees it. See src/lib/toolOutcome.ts.
type ToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
  outcome?: ToolOutcome;
};

// Voice tools handle every telos kind except "dimension" (review-session
// territory, MOO-490).
type TelosToolKind = Exclude<TelosKind, "dimension">;
const VOICE_TELOS_KINDS = TELOS_KINDS.filter(
  (k): k is TelosToolKind => k !== "dimension",
);

// Coerce an unknown body field to a trimmed, surrogate-safe string (or undefined).
function strArg(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? safeSlice(value.trim(), max)
    : undefined;
}

/**
 * How much of a Studio document Zola reads aloud before pointing at the page.
 *
 * A plan runs to thousands of words and this is a phone call. Cut here rather
 * than left to her, because a model asked to "summarise if long" will summarise
 * a document he asked to HEAR.
 */
const STUDIO_SPOKEN_CHARS = 2400;

/** A few words of a passage, enough to tell two paragraphs apart out loud. */
function excerptOf(text: string): string {
  return text.length <= 90 ? text : `${text.slice(0, 90).trimEnd()}…`;
}

/**
 * How many tasks one spoken project blueprint may carry.
 *
 * The research document's warning, made concrete: an agent asked to turn a
 * conversation into work will happily produce forty items nobody will read.
 */
const MAX_BLUEPRINT_TASKS = 12;

/**
 * The project Tarik meant, or a question.
 *
 * No name given falls back to the configured default, which is what makes
 * "add calling the bank to my list" a single sentence.
 */
async function resolvePlaneProject(
  secret: string,
  named: string | undefined,
): Promise<
  | { ok: true; id: string; name: string }
  | { ok: false; result: { ok: boolean; message: string; data?: unknown } }
> {
  if (!named) {
    const fallback = await convex.query(api.planeSettings.forTools, { secret });
    if (!fallback.projectId) {
      return {
        ok: false,
        result: {
          ok: false,
          message: "I don't have a default project set. Pick one on your control panel.",
        },
      };
    }
    return { ok: true, id: fallback.projectId, name: fallback.projectName };
  }

  const matches = rankProjects(await listProjects(), named);
  if (matches.length === 0) {
    return { ok: false, result: { ok: true, message: `No project matches ${named}.` } };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      result: {
        ok: true,
        message: `I have ${matches.length}: ${matches.map((m) => m.name).join("; ")}. Which one?`,
        data: { matches },
      },
    };
  }
  return { ok: true, id: matches[0].id, name: matches[0].name };
}

/** The work items a spoken quote could mean. Returns every candidate. */
function matchWorkItems<T extends { name: string }>(items: T[], quote: string): T[] {
  const needle = quote.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!needle) return [];
  return items.filter((i) =>
    i.name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").includes(needle),
  );
}

/**
 * The state group behind a word someone said.
 *
 * Spoken English does not match Plane's vocabulary — nobody says "unstarted".
 * Resolved to a GROUP rather than a state name, because names are per-project
 * and customisable while groups are not.
 */
function groupForWord(word: string): string | undefined {
  if (/backlog|later|someday/.test(word)) return "backlog";
  if (/todo|to do|next|up next|waiting/.test(word)) return "unstarted";
  if (/progress|started|doing|working/.test(word)) return "started";
  if (/done|finished|complete/.test(word)) return "completed";
  if (/cancel|dropped|abandon/.test(word)) return "cancelled";
  return undefined;
}

/**
 * Plane's refusal, as a sentence Zola can say.
 *
 * Its errors arrive as `{"identifier":"The project identifier is already
 * taken"}` — the message is useful, the JSON around it is not, and reading a
 * brace out loud helps nobody.
 */
function planeComplaint(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    const first = Object.values(parsed).flat().find((v) => typeof v === "string");
    if (typeof first === "string") return first;
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return safeSlice(detail, 160);
}

function dateArg(value: unknown): string | undefined {
  const s = strArg(value, 10);
  return s && isValidDate(s) ? s : undefined;
}

function timeArg(value: unknown): string | undefined {
  const s = strArg(value, 5);
  return s && isValidTime(s) ? s : undefined;
}

function minutesArg(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? Math.round(value) : undefined;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
      });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tool: string }> },
) {
  const secret = process.env.MORPHEUS_TOOL_SECRET;
  if (!secret || req.headers.get("x-morpheus-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { tool } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // One span covers all 23 tools because every call routes through here —
  // including Convex crons, which call these same HTTP routes, so scheduled
  // workflows get traced without a conversation to hang off.
  const span = getTracer().startSpan(`tool.${tool}`);
  safeSetAttrs(span, {
    "openinference.span.kind": "TOOL",
    "tool.name": tool,
    "tool.args": body,
  });

  try {
    const gate = await convex.query(api.secondBrain.toolGate, {
      secret,
      name: tool,
    });
    if (!gate.allowed) {
      const message = `The ${tool.replace(/_/g, " ")} tool is disabled in the control panel, so it can't be used right now.`;
      safeSetAttrs(span, { "tool.outcome": "disabled", "tool.message": message });
      safeEndSpan(span);
      return NextResponse.json({ ok: false, message }, { status: 200 });
    }
    const result = await runTool(tool, body, secret, req.nextUrl.origin);
    safeSetAttrs(span, {
      "tool.outcome": classifyOutcome(result),
      "tool.message": result.message,
    });
    safeEndSpan(span);
    // The agent must never see `outcome` — it is telemetry, not an instruction.
    const { outcome: _outcome, ...wire } = result;
    return NextResponse.json(wire, { status: result.ok ? 200 : 400 });
  } catch (error) {
    safeSetAttrs(span, { "tool.outcome": "error" });
    safeEndSpan(span, error);
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 200 },
      );
    }
    await convex
      .mutation(api.secondBrain.reportToolError, {
        secret,
        name: tool,
        message: error instanceof Error ? error.message : String(error),
      })
      .catch(() => {});
    console.error(`Tool ${tool} failed:`, error);
    return NextResponse.json(
      {
        ok: false,
        message: `The ${tool.replace(/_/g, " ")} tool hit an internal error. Tell Tarik it needs attention in the control panel.`,
      },
      { status: 500 },
    );
  }
}

/**
 * The single contact a spoken name meant, or the sentence to say instead.
 *
 * One match or nothing. Zola never picks between two people here, for the same
 * reason find_contact hands back every candidate: changing or deleting the
 * wrong Marcus is not recoverable, and "which one?" costs one turn.
 *
 * Only Google rows can be acted on. A contact merged from iCloud has no
 * writable id, and pretending otherwise would report success over an untouched
 * address book.
 */
async function resolveOneContact(
  secret: string,
  query: string,
  verb: string,
): Promise<
  | { ok: true; match: { key: string; name: string; phones: string[]; emails: string[] }; resourceName: string }
  | { ok: false; result: ToolResult }
> {
  const { total, matches } = await convex.query(api.contacts.resolve, {
    secret,
    query,
    limit: 5,
  });
  if (matches.length === 0) {
    return { ok: false, result: { ok: true, message: `I don't have anyone matching ${query}.` } };
  }
  if (matches.length > 1) {
    const list = matches
      .map((m) => [m.name || "unnamed", m.phones[0], m.emails[0]].filter(Boolean).join(", "))
      .join("; ");
    return {
      ok: false,
      result: {
        ok: true,
        message: `${query} matches ${total} people: ${list}. Which one should I ${verb}?`,
        // Speakable fields only. The provider ids that resolve carries are for
        // this function, not for the transcript: handing Zola a
        // `people/c2280...` gives her a string she can only mangle, and the
        // next turn re-resolves by name anyway.
        data: {
          ambiguous: true,
          total,
          matches: matches.map((m) => ({
            name: m.name,
            phones: m.phones,
            emails: m.emails,
            org: m.org,
          })),
        },
      },
    };
  }

  const match = matches[0];
  const google = match.sources.find((s) => s.source === "google");
  if (!google) {
    return {
      ok: false,
      result: {
        ok: false,
        message: `${match.name || "That contact"} doesn't live in Google, so I can't change it.`,
      },
    };
  }
  return { ok: true, match, resourceName: google.sourceId };
}

async function runTool(
  tool: string,
  body: Record<string, unknown>,
  secret: string,
  origin: string,
): Promise<ToolResult> {
  switch (tool) {
    case "capture_thought": {
      const raw = typeof body.raw === "string" ? body.raw : "";
      const cleaned = typeof body.cleaned === "string" ? body.cleaned : raw;
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((t): t is string => typeof t === "string")
        : [];
      if (!cleaned) {
        return { ok: false, message: "Nothing to capture — empty thought." };
      }
      await convex.mutation(api.secondBrain.captureThought, {
        secret,
        raw,
        cleaned,
        tags,
      });
      return { ok: true, message: "Thought captured and on the dashboard." };
    }
    case "remember": {
      const content = typeof body.content === "string" ? body.content : "";
      const type = ["preference", "fact", "project", "person"].includes(
        body.type as string,
      )
        ? (body.type as "preference" | "fact" | "project" | "person")
        : "fact";
      if (!content) {
        return { ok: false, message: "Nothing to remember — empty content." };
      }
      await convex.mutation(api.secondBrain.remember, {
        secret,
        content,
        type,
      });
      return { ok: true, message: "Stored in memory." };
    }
    case "recall": {
      const searchQuery = typeof body.query === "string" ? body.query : "";
      if (!searchQuery) {
        return { ok: false, message: "Recall needs a search query." };
      }
      const results = await convex.action(api.memoryOps.hybridRecall, {
        secret,
        searchQuery,
      });
      await convex.mutation(api.secondBrain.markRecallHealthy, { secret });
      // Studio counts. Without it she says "nothing in the second brain matches
      // that" while holding a document that does — the worst failure a memory
      // tool has, because it teaches him to stop asking.
      const count =
        results.thoughts.length + results.memories.length + results.studio.length;
      return {
        ok: true,
        message:
          count === 0
            ? "Nothing in the second brain matches that."
            : `Found ${count} matching item(s).`,
        data: results,
      };
    }
    case "consolidate_memories": {
      const input = await convex.query(api.memoryOps.consolidationInput, {
        secret,
      });
      if (input.transcripts.length === 0 && input.journal.length === 0) {
        return {
          ok: true,
          message:
            "No conversations or journal entries in the last day — nothing to consolidate.",
        };
      }
      const ops = await runConsolidation(input);
      const result = await convex.action(
        api.memoryOps.applyConsolidationFromTool,
        {
          secret,
          newMemories: ops.newMemories as {
            content: string;
            type: "preference" | "fact" | "project" | "person";
            transcriptId?: Id<"transcripts">;
          }[],
          updates: ops.updates as { id: Id<"memories">; content: string }[],
          deletes: ops.deletes as Id<"memories">[],
          telosUpdates: ops.telosUpdates as {
            id: Id<"telosItems">;
            text?: string;
            status?: "active" | "deferred" | "done" | "dropped";
            measurable?: string;
            transcriptId?: Id<"transcripts">;
          }[],
          journalIds: input.journal.map((j) => j.id) as Id<"journalEntries">[],
        },
      );
      return {
        ok: true,
        message: `Consolidated ${input.transcripts.length} conversation(s) and ${input.journal.length} journal entr(ies): ${result.added} new memories, ${result.updated} updated, ${result.deleted} merged away, ${result.telosApplied} telos update(s).`,
        data: result,
      };
    }
    case "get_calendar": {
      const date = dateArg(body.date);
      const { date: day, events } = await getCalendarEvents(date);
      await convex.mutation(api.secondBrain.pushBriefingCards, {
        secret,
        tool: "get_calendar",
        cards: events.slice(0, 6).map((e) => ({
          kind: "calendar" as const,
          title: e.title,
          body: `${e.allDay ? "All day" : formatTime(e.start)}${
            e.location ? ` · ${e.location}` : ""
          } · ${e.account}`,
        })),
      });
      return {
        ok: true,
        message:
          events.length === 0
            ? `Nothing on the calendar for ${day}.`
            : `${events.length} event(s) on ${day}.`,
        data: { date: day, events },
      };
    }
    case "create_calendar_event": {
      const title = strArg(body.title, 200);
      const date = dateArg(body.date);
      const time = timeArg(body.time);
      if (!title) return { ok: false, message: "The event needs a title." };
      if (!date) {
        return { ok: false, message: "Pass date as YYYY-MM-DD — compute it from what Tarik said first." };
      }
      if (!time) {
        return { ok: false, message: "Pass time as 24-hour HH:MM — compute it from what Tarik said first." };
      }
      const durationMinutes = minutesArg(body.duration_minutes) ?? 60;
      // Attendees trigger real invite emails — parse strictly, cap the list.
      const attendees =
        typeof body.attendees === "string"
          ? body.attendees
              .split(/[\s,]+/)
              .filter((a) => a.includes("@"))
              .slice(0, 10)
          : undefined;
      const res = await createCalendarEvent({
        title,
        date,
        time,
        durationMinutes,
        location: strArg(body.location, 200),
        description: strArg(body.description, 500),
        attendees,
        account: strArg(body.account, 40),
      });
      void convex
        .mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "create_calendar_event",
        })
        .catch(() => {});
      return {
        ok: true,
        message: `Created "${title}" on ${date} at ${time} (${durationMinutes} min) on the ${res.account} calendar.`,
      };
    }
    case "update_calendar_event": {
      const match = strArg(body.match, 100);
      if (!match) {
        return { ok: false, message: "update_calendar_event needs match text from the event title." };
      }
      const date = dateArg(body.date) ?? chicagoToday();
      const newDate = dateArg(body.new_date);
      const newTime = timeArg(body.new_time);
      const newDurationMinutes = minutesArg(body.new_duration_minutes);
      const newTitle = strArg(body.new_title, 200);
      if (!newDate && !newTime && newDurationMinutes === undefined && !newTitle) {
        return { ok: false, message: "Nothing to change — pass a new time, date, duration, or title." };
      }
      const res = await updateCalendarEventByMatch({
        match,
        date,
        newDate,
        newTime,
        newDurationMinutes,
        newTitle,
        account: strArg(body.account, 40),
      });
      if (res.outcome === "not_found") {
        return {
          ok: true,
          outcome: "no_match",
          message: `No timed event matching "${match}" on ${date}. Ask Tarik which event he means (all-day events can't be moved yet).`,
        };
      }
      if (res.outcome === "ambiguous") {
        return {
          ok: true,
          outcome: "ambiguous",
          message: `Several events match — ask Tarik which one: ${res.candidates.join("; ")}.`,
        };
      }
      void convex
        .mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "update_calendar_event",
        })
        .catch(() => {});
      return {
        ok: true,
        message: `Updated "${res.title}" — now ${res.start} on the ${res.account} calendar.`,
      };
    }
    case "get_emails": {
      // Muted senders and subjects are excluded at Gmail, so the robots never
      // reach Zola or the morning brief — and never spend one of the six
      // slots this asks for.
      const mutes = await convex.query(api.mailFilters.forTools, { secret });
      const emails = await getRecentEmails(mutes);
      await convex.mutation(api.secondBrain.pushBriefingCards, {
        secret,
        tool: "get_emails",
        cards: emails.slice(0, 6).map((e) => ({
          kind: "email" as const,
          title: e.subject || "(no subject)",
          body: `${e.from} · ${e.account} — ${safeSlice(e.snippet, 100)}`,
        })),
      });
      return {
        ok: true,
        message:
          emails.length === 0
            ? "No new primary inbox email in the last day."
            : `${emails.length} recent email(s).`,
        data: { emails },
      };
    }
    case "web_research":
    case "agentkey_research": {
      const query = typeof body.query === "string" ? body.query : "";
      if (!query) return { ok: false, message: "Research needs a query." };
      const results: ResearchResult[] =
        tool === "web_research"
          ? await composioResearch(query)
          : await agentkeyResearch(query);
      await convex.mutation(api.secondBrain.pushBriefingCards, {
        secret,
        tool,
        cards: results.slice(0, 4).map((r) => ({
          kind: "research" as const,
          title: r.title,
          body: r.snippet,
          url: r.url || undefined,
        })),
      });
      return {
        ok: true,
        message:
          results.length === 0
            ? "No results found for that."
            : `${results.length} sources found; they're on the dashboard.`,
        data: { results },
      };
    }
    // Viewport (MOO-485): Zola drives a real browser; findings become a
    // brief. The runner is fired-and-forgotten so the voice reply is instant.
    case "browse": {
      const task = strArg(body.task, 600);
      if (!task) {
        return { ok: false, message: "What should I go look into?" };
      }
      // Bare unless Tarik asked for his logins in this request. Never a
      // default: an agent holding live cookies while reading arbitrary pages
      // is what prompt injection aims at.
      const withLogins = body.use_my_logins === true;
      const session = await createBrowserSession({ withLogins });
      try {
        // startSession's insert is the atomic one-at-a-time guard.
        await convex.mutation(api.browserSessions.startSession, {
          secret,
          sessionId: session.sessionId,
          status: "running",
          task,
          liveViewUrl: session.liveViewUrl,
          replayUrl: session.replayUrl,
        });
      } catch {
        await endBrowserSession(session.sessionId).catch(() => {});
        return {
          ok: false,
          message:
            "The viewport already has a session open — end it first, or take a look at what's running.",
        };
      }
      try {
        const fired = await fetch(new URL("/api/browser/run", origin), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-morpheus-secret": secret,
          },
          body: JSON.stringify({ sessionId: session.sessionId, task }),
        });
        if (!fired.ok) throw new Error(`runner refused: ${fired.status}`);
      } catch (error) {
        await convex.mutation(api.browserSessions.updateSession, {
          secret,
          sessionId: session.sessionId,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
        await endBrowserSession(session.sessionId).catch(() => {});
        return {
          ok: false,
          message:
            "The browser runner wouldn't start — tell Tarik to check the control panel.",
        };
      }
      void convex
        .mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "browse",
        })
        .catch(() => {});
      return {
        ok: true,
        message:
          "On it — watch the viewport. I'll write up what I find as a brief.",
        data: { sessionId: session.sessionId },
      };
    }
    // Feed manager by voice (MOO-486): mutates the briefFeeds setting the
    // morning brief reads — no engine changes.
    case "manage_feeds": {
      const action = strArg(body.action, 10);
      if (action === "list") {
        const groups = await convex.query(api.feeds.listFeedsFromTool, { secret });
        if (groups.length === 0) {
          return { ok: true, message: "No feed groups configured yet." };
        }
        const summary = groups
          .map((g) => `${g.label}: ${g.feeds.length} feed${g.feeds.length === 1 ? "" : "s"}`)
          .join("; ");
        return { ok: true, message: `Brief feeds — ${summary}.`, data: { groups } };
      }
      if (action === "remove") {
        const match = strArg(body.site, 200);
        if (!match) {
          return { ok: false, message: "Which feed should I remove?" };
        }
        const result = await convex.mutation(api.feeds.manageFeedsFromTool, {
          secret,
          action: "remove",
          match,
        });
        if (result.outcome === "none") {
          return { outcome: "no_match", ok: false, message: `No brief feed matches "${match}" — nothing removed.` };
        }
        if (result.outcome === "ambiguous") {
          const names = (result.candidates ?? []).map((c) => c.url).join("; ");
          return {
            ok: false,
            outcome: "ambiguous",
            message: `Several feeds match: ${names}. Which one? Nothing removed yet.`,
          };
        }
        return {
          ok: true,
          message: `Removed ${result.url} from ${result.group}. Gone from the next brief.`,
        };
      }
      if (action === "add") {
        const site = strArg(body.site, 300);
        const category = strArg(body.category, 80);
        if (!site || !category) {
          return { ok: false, message: "I need a site and a category to add a feed." };
        }
        const feed = await discoverFeed(site);
        if (!feed) {
          return {
            ok: false,
            message: `I couldn't find a working RSS feed for "${site}" — nothing saved. If you know the exact feed URL, give me that.`,
          };
        }
        const result = await convex.mutation(api.feeds.manageFeedsFromTool, {
          secret,
          action: "add",
          feedUrl: feed.feedUrl,
          group: category,
        });
        return {
          ok: true,
          message:
            result.outcome === "existing"
              ? `${feed.title} is already in ${result.group}.`
              : `Added ${feed.title} to ${result.group}. It'll be in the next brief.`,
          data: { feedUrl: feed.feedUrl, group: result.group },
        };
      }
      return { ok: false, message: "manage_feeds needs action add, remove, or list." };
    }
    case "get_rss": {
      const feeds =
        typeof body.feeds === "string"
          ? body.feeds.split(/\s+/).filter(Boolean)
          : [];
      if (feeds.length === 0) {
        return { ok: false, message: "get_rss needs a feeds list." };
      }
      const { results, statuses } = await fetchFeedGroup(feeds);
      await Promise.all([
        // Health badge data for the Control Panel — never load-bearing.
        convex
          .mutation(api.feeds.reportFeedHealth, { secret, entries: statuses })
          .catch(() => {}),
        convex.mutation(api.secondBrain.pushBriefingCards, {
          secret,
          tool: "get_rss",
          cards: results.slice(0, 4).map((r) => ({
            kind: "research" as const,
            title: r.title,
            body: r.snippet,
            url: r.url || undefined,
          })),
        }),
      ]);
      return {
        ok: true,
        message:
          results.length === 0
            ? "No fresh items in those feeds."
            : `${results.length} fresh item(s) from the feeds.`,
        data: { results },
      };
    }
    case "run_workflow": {
      const name = typeof body.name === "string" ? body.name : "";
      const topic = typeof body.topic === "string" ? body.topic : undefined;
      if (!name) {
        return { ok: false, message: "run_workflow needs a workflow name." };
      }
      const res = await convex.action(api.workflows.runFromTool, {
        secret,
        name,
        topic,
      });
      if (!res.ok) return { ok: false, message: res.message };
      return {
        ok: true,
        message: `On it — the ${name.replace(/-/g, " ")} is building on the Briefs page now.`,
      };
    }
    // Archive search (MOO-495): server scores candidates; Zola — an LLM —
    // does the actual semantic resolution from the ranked list, then opens
    // the winner with navigate_ui. No embedding infra needed.
    case "find_brief": {
      const query = strArg(body.query, 200);
      if (!query) {
        return { ok: false, message: "What brief should I look for?" };
      }
      const briefs = await convex.query(api.workflows.briefSummariesFromTool, {
        secret,
      });
      const ranked = rankBriefs(briefs, query, 5);
      // Zero keyword overlap ≠ no match — hand Zola the recent archive and
      // let her judge semantically (that's the whole contract).
      const pool = ranked.length > 0 ? ranked : briefs.slice(0, 5);
      const candidates = pool.map((b) => ({
        title: b.title,
        kind: briefKind(b.workflowName).label,
        date: chicagoDateTime(b._creationTime),
        headings: b.headings.slice(0, 6),
      }));
      void convex
        .mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "find_brief",
        })
        .catch(() => {});
      if (candidates.length === 0) {
        return { outcome: "no_match", ok: false, message: "The archive is empty." };
      }
      return {
        ok: true,
        message: `${candidates.length} candidate brief(s)${ranked.length === 0 ? " (no keyword overlap — these are the most recent; judge for yourself)" : ""}. Pick the best match yourself, tell Tarik which, then open it with navigate_ui (page briefs, target = a distinctive fragment of its title). If none fit, say so.`,
        data: { candidates },
      };
    }
    case "get_brief": {
      const brief = await convex.query(api.workflows.latestReadyBrief, {
        secret,
      });
      await convex.mutation(api.workflows.markBriefToolHealthy, { secret });
      if (!brief) {
        return {
          ok: true,
          message:
            "No pre-built brief is ready. Fall back to get_calendar and get_emails for a live briefing.",
        };
      }
      return {
        ok: true,
        // The lede is the whole spoken briefing. The section-count wording is
        // the fallback for briefs built before this existed, and for a run
        // whose writer failed.
        message:
          brief.lede ??
          `Brief "${brief.title}" is ready with ${brief.sections.length} section(s). Speak from its sections.`,
        data: {
          title: brief.title,
          // She cannot follow two different rituals from one tool unless the
          // tool tells her which one she is in — the weekly review is walked
          // item by item, a morning brief is read and stopped on.
          workflow: brief.workflowName,
          builtAt: brief.runStartedAt,
          lede: brief.lede,
          sections: brief.sections.map((s) => ({
            heading: s.heading,
            body: s.body.slice(0, 1200),
          })),
        },
      };
    }
    case "telos_brief": {
      const [items] = await Promise.all([
        convex.query(api.telos.listItems, { secret }),
        convex.mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "telos_brief",
        }),
      ]);
      const body = buildGoalsSection(items, Date.now());
      return { ok: true, message: "Goals section built.", data: { body } };
    }
    case "habit_review": {
      const [habits] = await Promise.all([
        convex.query(api.habits.list, { secret }),
        convex.mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "habit_review",
        }),
      ]);
      const weeks = await Promise.all(
        habits.map(async (h) => {
          const traj = await convex.query(api.habits.trajectory, {
            habitId: h._id,
            days: 7,
            secret,
          });
          const friction = await convex.query(api.habits.weekFriction, {
            habitId: h._id,
            secret,
          });
          return { pillar: h.pillar, days: traj.series, friction };
        }),
      );
      const body = buildHabitReview(weeks);
      return { ok: true, message: "Habits section built.", data: { body } };
    }
    case "journal_digest": {
      const [entries] = await Promise.all([
        convex.query(api.journal.weekEntries, { secret }),
        convex.mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "journal_digest",
        }),
      ]);
      const body = buildJournalDigest(
        entries.map((j) => ({ text: j.text, mode: j.mode, at: j._creationTime })),
      );
      return { ok: true, message: "Journal digest built.", data: { body } };
    }
    // Zola drafts, Tarik sends (MOO-494). This case creates Gmail drafts and
    // NOTHING else — no send action exists anywhere in the tool surface.
    case "draft_email": {
      const intent = strArg(body.intent, 1200);
      if (!intent) {
        return { ok: false, message: "Tell me what the email should say first." };
      }
      const account = strArg(body.account, 60);
      const replyMatch = strArg(body.reply_match, 200);
      const reply = replyMatch
        ? await resolveReplyTarget(replyMatch, account)
        : null;
      if (reply?.outcome === "none") {
        return {
          ok: false,
          outcome: "no_match",
          message: `I couldn't find a recent thread matching "${replyMatch}", so I haven't drafted anything.`,
        };
      }
      if (reply?.outcome === "ambiguous") {
        const names = reply.candidates
          .map((c) => `"${c.subject}" from ${c.from}`)
          .join("; ");
        return {
          ok: false,
          outcome: "ambiguous",
          message: `A few threads match — ${names}. Which one do you mean? Nothing drafted yet.`,
        };
      }
      const resolved = reply?.outcome === "resolved" ? reply : null;
      const to = strArg(body.to, 200) ?? (resolved?.to || undefined);
      if (!to) {
        return { ok: false, message: "Who should this email go to?" };
      }
      const subject = strArg(body.subject, 200) ?? resolved?.subject ?? "";
      const bodyHtml = await draftEmailBody({
        intent,
        to,
        subject,
        thread: resolved?.thread,
      });
      const draft = await createDraft({
        to,
        subject,
        bodyHtml,
        account: resolved?.account ?? account,
        threadId: resolved?.threadId,
      });
      await convex.mutation(api.zolaDrafts.markZolaDraft, {
        secret,
        draftId: draft.draftId,
        account: draft.account,
      });
      return {
        ok: true,
        message: `Draft's ready on your Mail page — to ${to}${resolved ? ", threaded on that conversation" : ""}. It won't go anywhere until you send it.`,
        data: { draftId: draft.draftId, account: draft.account },
      };
    }
    case "journal_entry": {
      const text = strArg(body.text, 2000);
      const mode = body.mode === "reflection" ? "reflection" : "capture";
      if (!text) {
        return { ok: false, message: "Nothing to journal — empty entry." };
      }
      await convex.mutation(api.journal.addEntry, { secret, text, mode });
      return {
        ok: true,
        message:
          mode === "reflection" ? "Reflection saved." : "Journaled. It's in the book.",
      };
    }
    case "get_telos": {
      const kind = VOICE_TELOS_KINDS.includes(body.kind as TelosToolKind)
        ? (body.kind as TelosToolKind)
        : undefined;
      const [items] = await Promise.all([
        convex.query(api.telos.listItems, { secret, kind }),
        convex.mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "get_telos",
        }),
      ]);
      if (items.length === 0) {
        return {
          ok: true,
          message:
            "The telos is empty — offer to run the setup interview: ask about mission, then goals with measurables, then problems and challenges, creating each with add_telos_item.",
        };
      }
      return {
        ok: true,
        message: `${items.length} active telos item(s). Speak from them naturally.`,
        // Lean payload for the voice prompt — cadence bookkeeping stays home.
        data: {
          items: items.map(({ kind, text, measurable, status }) => ({
            kind,
            text,
            measurable,
            status,
          })),
        },
      };
    }
    case "add_telos_item": {
      const kind = body.kind as TelosToolKind;
      const text = strArg(body.text, 500) ?? "";
      const measurable = strArg(body.measurable, 200);
      if (!VOICE_TELOS_KINDS.includes(kind)) {
        return {
          ok: false,
          message: `add_telos_item needs a kind: ${VOICE_TELOS_KINDS.join(", ")}.`,
        };
      }
      if (!text) return { ok: false, message: "add_telos_item needs text." };
      const res = await convex.mutation(api.telos.addItem, {
        secret,
        kind,
        text,
        measurable,
      });
      return {
        ok: true,
        message: res.created
          ? `Added to the telos as a ${kind}.`
          : "That's already in the telos.",
      };
    }
    case "update_telos_item": {
      const match = typeof body.match === "string" ? body.match.trim() : "";
      if (!match) {
        return { ok: false, message: "update_telos_item needs match text." };
      }
      const status = TELOS_STATUSES.includes(body.status as TelosStatus)
        ? (body.status as TelosStatus)
        : undefined;
      const res = await convex.mutation(api.telos.updateItemByMatch, {
        secret,
        match,
        text: strArg(body.text, 500),
        status,
        measurable: strArg(body.measurable, 200),
      });
      if (res.outcome === "not_found") {
        return {
          ok: true,
          outcome: "no_match",
          message: `No active telos item matches "${match}". Ask Tarik which item he means.`,
        };
      }
      if (res.outcome === "ambiguous") {
        return {
          ok: true,
          outcome: "ambiguous",
          message: `Several items match — ask Tarik which one: ${res.candidates.join("; ")}.`,
        };
      }
      return {
        ok: true,
        message: `Updated: ${res.item.text} (${res.item.status}).`,
      };
    }
    case "get_habits": {
      const [rows] = await Promise.all([
        convex.query(api.habits.today, { secret }),
        convex.mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "get_habits",
        }),
      ]);
      if (rows.length === 0) {
        return {
          ok: true,
          message: "You don't have any active habits yet. Want to set one up?",
        };
      }
      const done = rows.filter((r) => r.level);
      const open = rows.filter((r) => !r.level);
      const openList = open.map((r) => r.pillar).join(", ");
      return {
        ok: true,
        message:
          open.length === 0
            ? `All ${rows.length} votes are in for today.`
            : `${done.length} of ${rows.length} votes are in. Still open: ${openList}.`,
        data: rows,
      };
    }
    case "log_habit_vote": {
      const habitId = strArg(body.habit_id, 64);
      const level = strArg(body.level, 20);
      if (!habitId || !level) {
        return { ok: false, message: "Which habit, and at what level?" };
      }
      const voted = await convex.mutation(api.habits.logVote, {
        secret,
        habitId: habitId as Id<"habits">,
        level: level as "minimum" | "standard" | "beyond" | "skipped" | "missed",
        note: strArg(body.note, 400) || undefined,
        source: "voice",
      });
      return { ok: true, message: `Logged as ${voted.level}.` };
    }
    case "add_habit": {
      const pillar = strArg(body.pillar, 80);
      const identity = strArg(body.identity, 200);
      const minimumAction = strArg(body.minimum_action, 200);
      const standardAction = strArg(body.standard_action, 200);
      const cue = strArg(body.cue, 200);
      if (!pillar || !identity || !minimumAction || !standardAction || !cue) {
        return {
          ok: false,
          message:
            "I need the pillar, identity, minimum action, standard action, and cue to set this up.",
        };
      }
      const res = await convex.mutation(api.habits.upsertHabit, {
        secret,
        pillar,
        identity,
        minimumAction,
        standardAction,
        cue,
        backupPlan: strArg(body.backup_plan, 200) || undefined,
      });
      return {
        ok: true,
        message: "Added. That's the system — the vote is what counts.",
        data: res,
      };
    }
    case "update_habit": {
      const habitId = strArg(body.habit_id, 64);
      if (!habitId) return { ok: false, message: "Which habit?" };
      const minimumAction = strArg(body.minimum_action, 200) || undefined;
      const cue = strArg(body.cue, 200) || undefined;
      const backupPlan = strArg(body.backup_plan, 200) || undefined;
      const status =
        (strArg(body.status, 20) as "active" | "paused" | "retired") ||
        undefined;
      await convex.mutation(api.habits.upsertHabit, {
        secret,
        habitId: habitId as Id<"habits">,
        minimumAction,
        cue,
        backupPlan,
        status,
      });
      const changed = [
        minimumAction && `minimum action to "${minimumAction}"`,
        cue && `cue to "${cue}"`,
        backupPlan && `backup plan to "${backupPlan}"`,
        status && `status to ${status}`,
      ].filter(Boolean);
      return {
        ok: true,
        message:
          changed.length > 0 ? `Updated: ${changed.join(", ")}.` : "Updated.",
      };
    }
    case "log_friction": {
      const habitId = strArg(body.habit_id, 64);
      const text = strArg(body.text, 400);
      if (!habitId || !text) {
        return { ok: false, message: "Which habit, and what got in the way?" };
      }
      await convex.mutation(api.habits.logFriction, {
        secret,
        habitId: habitId as Id<"habits">,
        text,
      });
      return {
        ok: true,
        message: "Noted. We'll change one thing at the weekly review.",
      };
    }
    /* Zola calls Tarik's phone. The guardrail is that there is no destination
     * parameter — the number comes from OWNER_PHONE and nothing in `body` can
     * redirect it. A persona instruction can be argued with; a parameter that
     * does not exist cannot. tests/callGuardrails.test.ts scans for this.
     * MOO-522 covers dialling anyone else, which needs spoken confirmation. */
    case "call_tarik": {
      const to = process.env.OWNER_PHONE?.trim();
      const agentId = process.env.ELEVENLABS_AGENT_ID;
      const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!to || !agentId || !phoneNumberId || !apiKey) {
        return {
          ok: false,
          message:
            "Calling isn't configured yet — OWNER_PHONE or the ElevenLabs phone settings are missing.",
        };
      }

      const reason = strArg(body.reason, 200);
      const res = await fetch(
        "https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call",
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agent_id: agentId,
            agent_phone_number_id: phoneNumberId,
            to_number: to,
          }),
        },
      );
      // The provider returns 200 with success:false when SIP rejects the call,
      // so status alone is not the outcome. Verified against a real call.
      const payload = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
      };
      if (!res.ok || payload.success === false) {
        return {
          ok: false,
          message: `I couldn't place the call: ${payload.message ?? res.status}`,
        };
      }
      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "call_tarik",
      });
      return {
        ok: true,
        message: reason
          ? `Calling you now about ${reason}.`
          : "Calling you now.",
      };
    }

    /* Documents (MOO-583). Saving is not sharing: this writes a file only
     * Tarik can reach, so it needs no confirm gate. The moment it could mint
     * a link that argument would be false — tests/documentToolsGuardrail
     * scans this arm for exactly that. */
    case "save_document": {
      const sourceType = strArg(body.source_type, 20);
      const now = Date.now();
      let built;
      let sourceId: string | undefined;

      if (sourceType === "brief") {
        const brief = await convex.query(api.workflows.latestReadyBrief, {
          secret,
        });
        if (!brief) {
          return { ok: false, message: "There's no brief ready to save." };
        }
        built = buildDocumentFromBrief(brief, now);
        sourceId = brief._id;
      } else if (sourceType === "journal_digest") {
        const entries = await convex.query(api.journal.weekEntries, { secret });
        if (entries.length === 0) {
          return { ok: false, message: "There's nothing in the journal this week." };
        }
        built = buildDocumentFromJournal(
          buildJournalDigest(
            entries.map((j) => ({
              text: j.text,
              mode: j.mode,
              at: j._creationTime,
            })),
          ),
          now,
        );
      } else if (sourceType === "research") {
        const query = strArg(body.query, 200);
        if (!query) {
          return { ok: false, message: "What research should I save?" };
        }
        // Re-run rather than save what Zola remembers. A file of URLs is
        // only worth keeping if the URLs are real ones.
        const results = await composioResearch(query);
        built = buildDocumentFromResearch(query, results, now);
      } else {
        return {
          ok: false,
          message:
            "I can save a brief, a research result, or this week's journal digest.",
        };
      }

      const objectKey = objectKeyFor(built.title, "md", now);
      const bytes = Buffer.from(built.body, "utf8");
      await uploadBuffer(objectKey, bytes, built.contentType);

      const { documentId } = await convex.mutation(api.documents.saveDocument, {
        secret,
        title: built.title,
        sourceType: sourceType as "brief" | "research" | "journal_digest",
        sourceId,
        objectKey,
        filename: built.filename,
        contentType: built.contentType,
        sizeBytes: bytes.byteLength,
      });

      await convex.mutation(api.secondBrain.pushBriefingCards, {
        secret,
        tool: "save_document",
        cards: [
          {
            kind: "note",
            title: built.title,
            body: `Saved as ${built.filename}.`,
          },
        ],
      });

      return {
        ok: true,
        message: `Saved "${built.title}" as a document. It's private until you ask me to share it.`,
        data: { documentId, title: built.title, filename: built.filename },
      };
    }
    /* Sharing is the one act that reaches past Clerk, so it is two calls.
     * The first writes nothing and hands back a token; the second spends it.
     * The `return` between them is load-bearing: without it the route would
     * mint its own token and immediately spend it, and the gate would be
     * decoration. See MOO-579 and convex/documentsLib.ts. */
    case "share_document": {
      const documentId = strArg(body.document_id, 64);
      if (!documentId) {
        return { ok: false, message: "Which document should I share?" };
      }
      const token = strArg(body.confirmation_token, 64);

      if (!token) {
        const asked = await convex.mutation(api.documents.requestShare, {
          secret,
          documentId: documentId as Id<"documents">,
        });
        return {
          ok: true,
          message: `Read this back to Tarik and get a yes before sharing: ${asked.summary}. A link works for anyone who has it, with no sign-in.`,
          data: {
            requiresConfirmation: true,
            confirmationToken: asked.confirmationToken,
            summary: asked.summary,
          },
        };
      }

      const expiresAt = shareExpiryFrom(
        typeof body.expires_in_days === "number"
          ? body.expires_in_days
          : strArg(body.expires_in_days, 10),
        Date.now(),
      );
      // A refused confirmation is a normal answer, not an outage. The
      // mutation throws on every denial — missing, spent, expired, wrong
      // document — and an uncaught throw here reaches the route's catch-all,
      // which returns a 500 and calls reportToolError. That would take
      // share_document down in the control panel for a gate doing its job.
      // Anything that isn't the denial still propagates.
      let link;
      try {
        link = await convex.mutation(api.documents.createShareLink, {
          secret,
          documentId: documentId as Id<"documents">,
          confirmationToken: token,
          expiresAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/not confirmed/i.test(message)) throw error;
        return {
          outcome: "no_match",
          ok: false,
          message:
            "That confirmation has already been used or has expired. Ask Tarik again, then start the share over.",
        };
      }

      // Explicit base rather than the request origin: the tool webhook is
      // called at whatever host ElevenLabs was given, and tarikos.app 308s to
      // www — a share link should not spend a redirect before it starts.
      const base = (process.env.SHARE_BASE_URL ?? origin).replace(/\/$/, "");
      const url = `${base}/f/${link.slug}`;
      return {
        ok: true,
        message: expiresAt
          ? `Shared. The link is ${url} and it stops working on ${chicagoDateTime(expiresAt)}.`
          : `Shared, with no expiry. The link is ${url} — it keeps working until you revoke it.`,
        data: { url, slug: link.slug, expiresAt },
      };
    }
    /* No gate, deliberately: making revocation hard would be the hazard. */
    case "revoke_document_share": {
      const slug = strArg(body.slug, 64);
      const documentId = strArg(body.document_id, 64);
      if (!slug && !documentId) {
        return { ok: false, message: "Which share should I revoke?" };
      }
      const result = await convex.mutation(api.documents.revokeShare, {
        secret,
        slug,
        documentId: documentId as Id<"documents"> | undefined,
      });
      if (result.found === 0) {
        return { outcome: "no_match", ok: false, message: "I couldn't find that share link." };
      }
      return {
        ok: true,
        message:
          result.revoked === 0
            ? "That link was already revoked."
            : `Revoked ${result.revoked} link${result.revoked === 1 ? "" : "s"}. It stops working immediately.`,
      };
    }

    /* Zola texts Tarik. The guardrail is the same as call_tarik's: there is
     * no destination parameter anywhere in this arm or in the published
     * schema, so the chat comes from TELEGRAM_OWNER_CHAT_ID on the server and
     * nothing in the body can redirect it. tests/telegramSendGuardrail scans
     * for that. */
    case "send_telegram": {
      const text = strArg(body.text, 3000);
      if (!text) {
        return { ok: false, message: "What should I send?" };
      }
      const sent = await notifyOwner(escapeHtml(text));
      if (!sent) {
        return {
          ok: false,
          message: "Telegram isn't configured, so I couldn't send that.",
        };
      }
      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "send_telegram",
      });
      return { ok: true, message: "Sent it to your Telegram." };
    }

    // Name -> phone/email, so "what's Marcus's number" and eventually "text
    // Marcus" resolve. The server ranks and Zola picks, the same shape as
    // find_brief: every candidate for an ambiguous name comes back so she can
    // ask which one, because silently choosing is how she texts the wrong
    // person.
    case "find_contact": {
      const q = strArg(body.query, 120);
      if (!q) return { ok: false, message: "Who are you looking for?" };

      const { total, matches } = await convex.query(api.contacts.search, {
        secret,
        query: q,
        limit: 5,
      });
      if (matches.length === 0) {
        return { ok: true, message: `I don't have anyone matching ${q}.`, data: { matches: [] } };
      }

      const describe = (m: (typeof matches)[number]) =>
        [m.name || "unnamed", m.phones[0], m.emails[0]].filter(Boolean).join(", ");
      const message =
        matches.length === 1
          ? describe(matches[0])
          : `I have ${total} matches for ${q}${total > matches.length ? `, here are ${matches.length}` : ""}: ${matches.map(describe).join("; ")}. Which one?`;

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "find_contact",
      });
      return { ok: true, message, data: { total, matches } };
    }

    // Write a new contact straight into Google. Write-through, not two-way
    // sync: Google stays the single source of truth and the next sync simply
    // reads it back, so there is no conflict to resolve and nothing can
    // diverge. It is stored locally too, so find_contact works immediately
    // rather than after tomorrow's cron.
    //
    // The persona requires a spoken confirmation before this is called, the
    // same ritual as create_calendar_event. Unlike a read, nothing undoes a
    // wrong write on the next sync — the sync will faithfully carry the
    // mistake back every day.
    case "add_contact": {
      const built = buildPersonPayload({
        name: strArg(body.name, 120) ?? "",
        phone: strArg(body.phone, 60),
        email: strArg(body.email, 200),
        org: strArg(body.org, 120),
      });
      if (!built.ok || !built.person) {
        return { ok: false, message: built.error ?? "I can't save that contact." };
      }

      // Refuse to create a second row for someone already in the book. A
      // duplicate is not a failed write, it is a slow corruption of the thing
      // find_contact reads.
      const identifier = strArg(body.phone, 60) ?? strArg(body.email, 200);
      if (identifier) {
        const existing = await convex.query(api.contacts.search, {
          secret,
          query: identifier,
          limit: 1,
        });
        if (existing.matches.length > 0) {
          return {
            ok: true,
            message: `You already have that number saved under ${existing.matches[0].name || "an unnamed contact"}.`,
            data: { duplicate: true, existing: existing.matches[0] },
          };
        }
      }

      const created = await createGoogleContact(built.person);
      // Store it now so a lookup a moment later finds it, rather than after
      // the next scheduled sync.
      const merged = mergeContacts(googlePeopleToContacts([created]));
      if (merged.length > 0) {
        await convex.mutation(api.contacts.upsertBatch, {
          secret,
          syncedAt: Date.now(),
          contacts: merged.map((c) => ({
            key: contactKey(c),
            name: c.name,
            phones: c.phones,
            emails: c.emails,
            org: c.org,
            photo: c.photo,
            sources: c.sources,
          })),
        });
      }

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "add_contact",
      });
      const saved = merged[0];
      return {
        ok: true,
        message: `Saved ${saved?.name || "the contact"}${saved?.phones[0] ? ` at ${saved.phones[0]}` : ""} to your Google contacts.`,
        data: { name: saved?.name, phones: saved?.phones, emails: saved?.emails },
      };
    }

    // Change someone already in the book. Write-through like add_contact:
    // Google is changed first, the stored row is refreshed from Google's own
    // response, and the next sync simply reads back what is already true.
    //
    // The dangerous part is not the write, it is the field mask. Google
    // replaces a named field entirely, so a new number displaces every number
    // the contact had. buildUpdatePayload reports what it displaced and the
    // confirmation reads it back, because that is the only moment the old
    // value still exists anywhere.
    case "update_contact": {
      const who = strArg(body.query, 120);
      if (!who) return { ok: false, message: "Who should I change?" };

      const found = await resolveOneContact(secret, who, "change");
      if (!found.ok) return found.result;

      // Fresh from Google, not from the stored row: updateContact rejects a
      // stale etag, and the current values decide what counts as a change.
      const current = await getGoogleContact(found.resourceName);
      const built = buildUpdatePayload(current as unknown as CurrentPerson, {
        name: strArg(body.name, 120),
        phone: strArg(body.phone, 60),
        email: strArg(body.email, 200),
        org: strArg(body.org, 120),
      });
      if (!built.ok || !built.person || !built.updatePersonFields) {
        return { ok: false, message: built.error ?? "I can't make that change." };
      }

      const updated = await updateGoogleContact(
        found.resourceName,
        current.etag as string,
        built.person,
        built.updatePersonFields,
      );
      const merged = mergeContacts(googlePeopleToContacts([updated]));
      if (merged.length > 0) {
        await convex.mutation(api.contacts.upsertBatch, {
          secret,
          syncedAt: Date.now(),
          contacts: merged.map((c) => ({
            key: contactKey(c),
            name: c.name,
            phones: c.phones,
            emails: c.emails,
            org: c.org,
            photo: c.photo,
            sources: c.sources,
          })),
        });
      }

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "update_contact",
      });
      const name = merged[0]?.name || found.match.name || "that contact";
      // "was 414-555-1234" is the part that matters. Without it a replaced
      // second number leaves no trace anywhere.
      const said = (built.replaced ?? [])
        .map((r) => `${r.field} is now ${r.to}${r.from.length ? ` (was ${r.from.join(" and ")})` : ""}`)
        .join(", ");
      return {
        ok: true,
        message: `Updated ${name}: ${said}.`,
        data: { name, replaced: built.replaced },
      };
    }

    // Remove someone from Google entirely. The one contact tool with nothing
    // behind it: no sync restores a deleted contact and Google keeps no undo,
    // which is why the persona has to confirm the full name out loud first and
    // why resolveOneContact refuses to choose between two people.
    case "delete_contact": {
      const who = strArg(body.query, 120);
      if (!who) return { ok: false, message: "Who should I delete?" };

      const found = await resolveOneContact(secret, who, "delete");
      if (!found.ok) return found.result;

      await deleteGoogleContact(found.resourceName);
      // Google first, then the local row. The other order would leave a
      // contact deleted here and alive there, and tomorrow's sync would put it
      // straight back with no sign anything happened.
      await convex.mutation(api.contacts.removeByKey, { secret, key: found.match.key });

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "delete_contact",
      });
      const name = found.match.name || "that contact";
      return {
        ok: true,
        message: `Deleted ${name}${found.match.phones[0] ? ` (${found.match.phones[0]})` : ""} from your Google contacts.`,
        data: { name },
      };
    }

    // Pull the address book from Google. Called by the cron, not by Zola —
    // nothing about a scheduled sync needs a model's judgement.
    //
    // Reads through the EXISTING Gmail connection, which was already granted
    // contacts.readonly: Composio's own googlecontacts toolkit reports no
    // managed auth schemes, so using it would mean a bring-your-own OAuth app
    // for access this connection already has.
    case "sync_contacts": {
      const startedAt = Date.now();
      let rows: unknown[] = [];
      try {
        rows = await fetchGooglePeople();
      } catch (error) {
        return {
          ok: false,
          message: `Contact sync failed: ${error instanceof Error ? error.message : "unknown"}`,
        };
      }

      const merged = mergeContacts(googlePeopleToContacts(rows as never));
      // A provider returning nothing is far more likely to be an outage than a
      // genuinely emptied address book, and sweepStale would delete everything.
      if (merged.length === 0) {
        return { ok: false, message: "Google returned no contacts; leaving the existing ones alone." };
      }

      let created = 0;
      let updated = 0;
      for (let i = 0; i < merged.length; i += CONTACT_BATCH) {
        const batch = merged.slice(i, i + CONTACT_BATCH).map((c) => ({
          key: contactKey(c),
          name: c.name,
          phones: c.phones,
          emails: c.emails,
          org: c.org,
          photo: c.photo,
          sources: c.sources,
        }));
        const res = await convex.mutation(api.contacts.upsertBatch, {
          secret,
          syncedAt: startedAt,
          contacts: batch,
        });
        created += res.created;
        updated += res.updated;
      }

      // Anything still carrying an older stamp was removed upstream.
      let deleted = 0;
      for (let pass = 0; pass < MAX_SWEEP_PASSES; pass++) {
        const res = await convex.mutation(api.contacts.sweepStale, {
          secret,
          syncedAt: startedAt,
          limit: CONTACT_BATCH,
        });
        deleted += res.deleted;
        if (!res.more) break;
      }

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "sync_contacts",
      });
      return {
        ok: true,
        message: `Synced ${merged.length} contacts (${created} new, ${updated} updated, ${deleted} removed).`,
        data: { total: merged.length, created, updated, deleted },
      };
    }

    // The paragraph a brief opens with, written after every section is built.
    //
    // Runner-only: this is NOT in provision-agent.ts, so Zola cannot call it.
    // She reads the lede; she never writes it.
    //
    // The containment is zolaReply's, and it matters more here. This is the
    // first thing in the system that turns a Gmail subject or a search snippet
    // into Zola's OWN words rather than a quotation, so the call holds the
    // sections and nothing else: no tools, no telos, no memory.
    case "write_lede": {
      const briefId = strArg(body.brief_id, 64);
      if (!briefId) {
        return { ok: false, message: "No brief to write a lede for." };
      }

      const material = await convex.query(api.workflows.briefForLede, {
        secret,
        briefId: briefId as Id<"briefs">,
      });
      if (!material) {
        return { ok: false, message: "That brief no longer exists." };
      }

      const lens = LENS[material.workflowName];
      if (!lens) {
        // memory-consolidation and anything added later. Not an error: a
        // workflow with no lens simply does not get a lede.
        return { ok: true, message: "No lede for this workflow.", data: { lede: "" } };
      }

      let written = "";
      try {
        const response = await new Anthropic().messages.create({
          model: MODEL,
          max_tokens: 400,
          system: `${LEDE_BRIEF}\n\n${lens}`,
          messages: [
            {
              role: "user",
              content: ledeInput(material.sections, material.previousLede),
            },
          ],
        });

        // 400 tokens is generous headroom over the 50-80 word target, so this
        // is rare. But trimLede only cuts at a sentence boundary when the
        // string is over MAX_LEDE_CHARS — a response truncated by the token
        // ceiling that happens to land under that length would otherwise pass
        // through untouched, mid-sentence, and Zola would read it out loud
        // with no error and nothing on the page to say it was cut off. A lede
        // stopped at the ceiling is the first half of a paragraph that was
        // going somewhere else; the runner already treats a missing lede as
        // fine, so failing here is the same failure philosophy one level down.
        if (response.stop_reason === "max_tokens") {
          return { ok: false, message: "The lede writer was cut off mid-thought." };
        }

        written = response.content
          .filter((c): c is Anthropic.TextBlock => c.type === "text")
          .map((c) => c.text)
          .join("\n")
          .slice(0, MAX_LEDE_CHARS * 3);
      } catch (error) {
        return {
          ok: false,
          message: `The lede writer failed: ${error instanceof Error ? error.message : "unknown"}`,
        };
      }

      const lede = trimLede(written);
      if (!lede) return { ok: false, message: "The lede writer returned nothing." };

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "write_lede",
      });
      return { ok: true, message: "Lede written.", data: { lede } };
    }

    // The morning brief, delivered instead of merely built. Called by the
    // workflow runner when a brief finishes, NOT by Zola — it is deliberately
    // absent from provision-agent.ts and textTools.ts, because nothing about
    // it needs a model's judgement.
    //
    // The off switch is the one every tool already has: toggling
    // send_brief_digest off in the control panel blocks this at the gate
    // above, before any work, and the brief still builds for the dashboard.
    case "send_brief_digest": {
      const title = strArg(body.title, 200);
      const sections = Array.isArray(body.sections) ? body.sections : [];
      if (!title || sections.length === 0) {
        return { ok: false, message: "Nothing to send — no brief sections." };
      }
      const lede = strArg(body.lede, 700);

      const text = briefDigest(
        title,
        sections.flatMap((raw) => {
          const s = raw as Record<string, unknown>;
          const heading = strArg(s.heading, 120);
          const sectionBody = strArg(s.body, 4000);
          return heading && sectionBody ? [{ heading, body: sectionBody }] : [];
        }),
        lede,
      );
      // Every section failed, so there is nothing worth waking him for. The
      // dashboard still carries the errors.
      if (!text) {
        return { ok: true, message: "Brief had nothing worth sending." };
      }

      const sent = await notifyOwner(text);
      if (!sent) {
        return {
          ok: false,
          message: "Telegram isn't configured, so the brief wasn't sent.",
        };
      }
      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "send_brief_digest",
      });
      return { ok: true, message: "Sent the brief to your Telegram." };
    }

    // ------------------------------------------------------------- Studio
    //
    // Four tools, one rule: she resolves to exactly ONE document, or she asks.
    // Modelled on find_contact, which learned it from real data — a name that
    // matches two people is a question, never a guess.
    //
    // And she PROPOSES; she never applies. Voice cannot show a diff, so voice
    // must not write into something he is holding. A proposal appears in the
    // open document while she is still talking, because Convex is realtime.

    case "find_studio_document": {
      const q = strArg(body.query, 200);
      if (!q) return { ok: false, message: "Which document are you looking for?" };

      const matches = await convex.query(api.studioTools.search, {
        secret,
        query: q,
        limit: 5,
      });
      if (matches.length === 0) {
        return {
          ok: true,
          message: `Nothing in Studio matches ${q}.`,
          data: { matches: [] },
        };
      }

      const describe = (m: (typeof matches)[number]) => `${m.title} — a ${m.docType}`;
      const message =
        matches.length === 1
          ? `${describe(matches[0])}. ${matches[0].excerpt}`
          : `I have ${matches.length} that could be it: ${matches.map(describe).join("; ")}. Which one?`;

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "find_studio_document",
      });
      return { ok: true, message, data: { matches } };
    }

    // Plain text, never the stored JSON tree. The tree is the editor's
    // business; handed to a speech model it is noise she can only mangle.
    case "read_studio_document": {
      const q = strArg(body.query, 200);
      if (!q) return { ok: false, message: "Which document should I read?" };

      const matches = await convex.query(api.studioTools.search, {
        secret,
        query: q,
        limit: 5,
      });
      if (matches.length === 0) {
        return { ok: true, message: `Nothing in Studio matches ${q}.` };
      }
      if (matches.length !== 1) {
        return {
          ok: true,
          message: `I have several: ${matches.map((m) => m.title).join("; ")}. Which one should I read?`,
          data: { matches },
        };
      }

      const doc = await convex.query(api.studioTools.read, {
        secret,
        id: matches[0].id,
        limit: STUDIO_SPOKEN_CHARS,
      });
      if (!doc) return { ok: false, message: "That document is gone." };

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "read_studio_document",
      });
      return {
        ok: true,
        // The truncation is SAID rather than hidden: a document that stops
        // mid-sentence with no explanation reads as a document that ends there.
        message: doc.truncated
          ? `${doc.text}\n\n(That is the first part of ${doc.title}; there is more on the page.)`
          : doc.text,
        data: { id: doc.id, title: doc.title, docType: doc.docType },
      };
    }

    // Dictation into a real document, shaped by its type's template — a brief
    // dictated over the phone is still a brief when he opens it.
    case "write_studio_document": {
      const type = strArg(body.doc_type, 20)?.toLowerCase();
      if (!type || !(DOC_TYPES as readonly string[]).includes(type)) {
        return {
          ok: false,
          message: `What kind of document — a ${DOC_TYPES.join(", a ")}?`,
        };
      }
      const text = strArg(body.text, 20_000) ?? "";
      const title = strArg(body.title, 120) ?? "";
      if (!title.trim() && !text.trim()) {
        return { ok: false, message: "What should the document say?" };
      }

      const created = await convex.mutation(api.studioTools.create, {
        secret,
        docType: type as (typeof DOC_TYPES)[number],
        title,
        text,
      });
      return {
        ok: true,
        message: `Started ${created.title} as a ${type}. It's in Studio.`,
        data: created,
      };
    }

    // The interesting one. She has no cursor, so she QUOTES the passage, and
    // the quote resolves exactly the way a contact name does.
    case "propose_studio_edit": {
      const which = strArg(body.document, 200);
      const quote = strArg(body.quote, 400);
      const instruction = strArg(body.instruction, 600);
      if (!which) return { ok: false, message: "Which document?" };
      if (!quote) return { ok: false, message: "Which passage — read me a few words of it?" };
      if (!instruction) return { ok: false, message: "What should I do to that passage?" };

      const found = await convex.query(api.studioTools.search, {
        secret,
        query: which,
        limit: 5,
      });
      if (found.length === 0) {
        return { ok: true, message: `Nothing in Studio matches ${which}.` };
      }
      if (found.length !== 1) {
        return {
          ok: true,
          message: `I have several: ${found.map((m) => m.title).join("; ")}. Which one?`,
          data: { matches: found },
        };
      }

      const doc = await convex.query(api.studioTools.blocks, {
        secret,
        id: found[0].id,
        quote,
      });
      if (!doc) return { ok: false, message: "That document is gone." };

      const matches = doc.matches;
      if (matches.length === 0) {
        return {
          ok: true,
          message: `I can't find anything about ${quote} in ${doc.title}.`,
        };
      }
      if (matches.length > 1) {
        // She reads them back and asks. She never picks — proposing against the
        // wrong paragraph is a rewrite he did not ask for, in a document he was
        // not looking at.
        return {
          ok: true,
          message: `Two passages mention that. One says: ${excerptOf(matches[0].text)}. The other: ${excerptOf(matches[1].text)}. Which one?`,
          data: { matches },
        };
      }

      const rewritten = await proposeRewrite({
        docType: doc.docType,
        references: doc.references,
        block: matches[0].text,
        instruction,
      });

      const stored = await convex.mutation(api.studioTools.propose, {
        secret,
        docId: found[0].id,
        blockIndex: matches[0].index,
        original: matches[0].text,
        proposed: rewritten,
        instruction,
      });
      if (!stored.ok) return { ok: false, message: "That document is gone." };

      return {
        ok: true,
        message: `I've suggested a version. It's waiting in ${doc.title} for you to take or leave.`,
        data: { id: stored.id, proposed: rewritten },
      };
    }

    // -------------------------------------------------------- Plane
    //
    // Projects and tasks. The requirement that shaped every one of these:
    // Tarik does not open plane.so. Creation happens here or the integration
    // is a viewer.
    //
    // Nothing is mirrored — every read is live against Plane, which owns work
    // items. And nothing here deletes or archives: those functions do not
    // exist in src/lib/plane.ts, so a mis-heard sentence cannot reach them.

    case "create_task": {
      const built = workItemPayload({
        title: strArg(body.title, 400) ?? "",
        description: strArg(body.description, 2000),
        priority: strArg(body.priority, 20),
        due: strArg(body.due, 10),
      });
      if (!built.ok) return { ok: false, message: built.error };

      const project = await resolvePlaneProject(secret, strArg(body.project, 120));
      if (!project.ok) return project.result;

      const created = await createWorkItem(project.id, built.payload);
      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "create_task",
      });
      // Confirmed AFTER, not asked before. A task is additive and deleting it
      // is one click — the calendar ritual would cost more than the mistake.
      return {
        ok: true,
        message: `Added ${created.name} to ${project.name}.`,
        data: { id: created.id, project: project.name },
      };
    }

    case "find_plane_project": {
      const q = strArg(body.query, 120);
      if (!q) return { ok: false, message: "Which project?" };

      const matches = rankProjects(await listProjects(), q);
      if (matches.length === 0) {
        return { ok: true, message: `No project matches ${q}.`, data: { matches: [] } };
      }
      const message =
        matches.length === 1
          ? `${matches[0].name}, ${matches[0].identifier}.`
          : `I have ${matches.length}: ${matches.map((m) => m.name).join("; ")}. Which one?`;

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "find_plane_project",
      });
      return { ok: true, message, data: { matches } };
    }

    case "get_project_status": {
      const project = await resolvePlaneProject(secret, strArg(body.project, 120));
      if (!project.ok) return project.result;

      const items = await listWorkItems(project.id);
      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "get_project_status",
      });
      return {
        ok: true,
        message: describeStatus(project.name, items),
        data: { total: items.length },
      };
    }

    // Resolved by QUOTING the task, the same handle propose_studio_edit uses:
    // over a phone call there is nothing to point at.
    case "update_task_state": {
      const quote = strArg(body.task, 300);
      const wanted = strArg(body.state, 40)?.toLowerCase();
      if (!quote) return { ok: false, message: "Which task — read me a few words of it?" };
      if (!wanted) return { ok: false, message: "Move it to what — todo, in progress, or done?" };

      const project = await resolvePlaneProject(secret, strArg(body.project, 120));
      if (!project.ok) return project.result;

      const [items, states] = await Promise.all([
        listWorkItems(project.id),
        listStates(project.id),
      ]);
      const matches = matchWorkItems(items, quote);
      if (matches.length === 0) {
        return { ok: true, message: `Nothing in ${project.name} matches ${quote}.` };
      }
      if (matches.length > 1) {
        // She never picks. Moving the wrong task is a state change he did not
        // ask for, in a project he was not looking at.
        return {
          ok: true,
          message: `Two match: ${matches.map((m) => m.name).join("; ")}. Which one?`,
          data: { matches },
        };
      }

      const target = states.find(
        (s) => s.group === groupForWord(wanted) || s.name.toLowerCase() === wanted,
      );
      if (!target) {
        return {
          ok: true,
          message: `${project.name} has no ${wanted} column. It has ${states.map((s) => s.name).join(", ")}.`,
        };
      }

      await updateWorkItem(project.id, matches[0].id, { state: target.id });
      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "update_task_state",
      });
      return {
        ok: true,
        message: `Moved ${matches[0].name} to ${target.name}.`,
        data: { id: matches[0].id, state: target.name },
      };
    }

    // A project is structural, so this one asks first. Without `confirmed` it
    // returns a blueprint and writes nothing — the research document's
    // approval card, in the only form a voice call has.
    case "create_plane_project": {
      const name = strArg(body.name, 120);
      if (!name) return { ok: false, message: "What should the project be called?" };

      // Derived against what already exists, on BOTH calls, so the code read
      // back in the blueprint is the code that gets created. A derived code
      // collides — "Pledge Drive 2026" and "2027" both give PLEDGEDR — and
      // Plane refuses a duplicate, which surfaced as a bare internal error.
      const existing = await listProjects();
      const identifier = projectIdentifier(
        name,
        existing.map((p) => p.identifier),
        strArg(body.identifier, 12),
      );
      const description = strArg(body.description, 2000);
      const tasks = Array.isArray(body.tasks)
        ? body.tasks.flatMap((t) => {
            const title = strArg(t, 400);
            return title ? [title] : [];
          }).slice(0, MAX_BLUEPRINT_TASKS)
        : [];

      if (!isConfirmed(body.confirmed)) {
        return {
          ok: true,
          message: `I'd create ${name}, code ${identifier}${tasks.length ? `, with ${tasks.length} task${tasks.length === 1 ? "" : "s"}: ${tasks.join("; ")}` : ", with no tasks yet"}. Say go ahead and I'll make it.`,
          data: { blueprint: { name, identifier, description, tasks } },
        };
      }

      let project;
      try {
        project = await createProject({ name, identifier, description });
      } catch (error) {
        // Plane's own words rather than "internal error". Its refusals are
        // actionable — a taken code, a name that is too long — and a caller who
        // is told what happened can fix it in the next sentence.
        if (error instanceof PlaneError) {
          return {
            ok: false,
            message: `Plane wouldn't create it: ${planeComplaint(error.detail)}`,
          };
        }
        throw error;
      }
      for (const title of tasks) {
        const built = workItemPayload({ title });
        if (built.ok) await createWorkItem(project.id, built.payload);
      }
      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "create_plane_project",
      });
      return {
        ok: true,
        message: `Created ${project.name}${tasks.length ? ` with ${tasks.length} task${tasks.length === 1 ? "" : "s"}` : ""}. It's on your Projects page.`,
        data: { id: project.id, identifier: project.identifier },
      };
    }

    // ---------------------------------------------------------- reminders

    case "remind_me": {
      const built = reminderAt(
        strArg(body.text, 400) ?? "",
        strArg(body.when, 40) ?? "",
        Date.now(),
      );
      if (!built.ok) return { ok: false, message: built.error };

      const how = channelOf(strArg(body.channel, 30));
      const stored = await convex.mutation(api.remindersDb.schedule, {
        secret,
        text: built.text,
        dueAt: built.dueAt,
        channel: how,
      });
      if (!stored.ok) {
        return { ok: false, message: "You have a lot of reminders pending. Clear some first." };
      }
      // Read back the TIME as well as the thing. A reminder set for the wrong
      // day is only catchable here, before it goes quiet for a week.
      return {
        ok: true,
        // The degradation is SAID. Asking to be phoned and being texted
        // without being told is how someone misses the reminder they set.
        message:
          `I'll remind you to ${built.text} on ${spokenTime(built.dueAt)}` +
          (how === "email" ? " by email." : ".") +
          (askedForACall(strArg(body.channel, 30))
            ? " I'll text it rather than call — I can only phone you when you ask me directly."
            : ""),
        data: { id: stored.id, dueAt: built.dueAt, channel: how },
      };
    }

    case "list_reminders": {
      const rows = await convex.query(api.remindersDb.pending, { secret });
      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "list_reminders",
      });
      return {
        ok: true,
        message: describeReminders(rows),
        data: { total: rows.length },
      };
    }

    case "cancel_reminder": {
      const quote = strArg(body.reminder, 300);
      if (!quote) return { ok: false, message: "Which reminder?" };

      const rows = await convex.query(api.remindersDb.pending, { secret });
      const matches = matchReminders(rows, quote);
      if (matches.length === 0) {
        return { ok: true, message: `You have no reminder about ${quote}.` };
      }
      if (matches.length > 1) {
        return {
          ok: true,
          message: `Two match: ${matches.map((m) => m.text).join("; ")}. Which one?`,
          data: { matches },
        };
      }
      await convex.mutation(api.remindersDb.cancel, {
        secret,
        id: matches[0].id as Id<"reminders">,
      });
      return { ok: true, message: `Cancelled ${matches[0].text}.` };
    }

    // Called by the Convex scheduler when a reminder comes due, never by Zola.
    // Deliberately absent from provision-agent.ts, like send_brief_digest:
    // nothing about delivering a reminder needs a model's judgement, and a tool
    // she can call is a tool she can call at the wrong moment.
    case "deliver_reminder": {
      const text = strArg(body.text, 400);
      if (!text) return { ok: false, message: "Nothing to deliver." };
      const how = channelOf(strArg(body.channel, 30));

      if (how === "email") {
        const sent = await emailOwner("Reminder", text);
        return sent.ok
          ? { ok: true, message: "Reminder emailed." }
          : { ok: false, message: `Email failed: ${sent.reason}` };
      }

      const sent = await notifyOwner(escapeHtml(`⏰ ${text}`));
      return sent
        ? { ok: true, message: "Reminder sent." }
        : { ok: false, message: "Telegram isn't configured." };
    }

    // Her own inbox, read live. Mail is DATA, never instructions: this case
    // reads and summarises, and there is deliberately no path from here to a
    // write of any kind. An inbox is a public front door into an agent's
    // context, and the allowlist is what stands in it.
    // docs/superpowers/specs/2026-08-12-zola-inbox-design.md
    case "check_zola_mail": {
      const wanted = strArg(body.from, 120);

      let messages;
      try {
        messages = received(await listMessages(20));
      } catch (err) {
        const why =
          err instanceof AgentMailError
            ? `AgentMail answered ${err.status}`
            : err instanceof Error
              ? err.message
              : "something went wrong";
        return { ok: false, message: `I could not read my inbox — ${why}.` };
      }

      const allowlist = inboxAllowlist(
        process.env.OWNER_EMAIL,
        process.env.ZOLA_MAIL_ALLOWLIST,
      );

      // `as: count` is the morning brief's call, and it is deliberately not in
      // the published schema — the shape deliver_reminder established. A brief
      // is built unattended and read aloud, so it gets how much arrived and
      // never what a stranger wrote.
      if (strArg(body.as, 20) === "count") {
        await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
          secret,
          name: "check_zola_mail",
        });
        return {
          ok: true,
          message: countInbox(messages, allowlist),
          data: { total: messages.length },
        };
      }

      const report = describeInbox(messages, allowlist, wanted);

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "check_zola_mail",
      });
      return {
        ok: true,
        message: report.message,
        data: { total: messages.length, read: report.shown.length, withheld: report.withheld },
      };
    }

    // She writes to him freely, and drafts to everyone else. These two cases are
    // that sentence, and the difference between them is structural rather than
    // written down: this one has no recipient argument at all.
    //
    // The call_tarik shape, applied to mail. emailOwner reads OWNER_EMAIL off
    // the server, so there is nothing to pass and nothing to talk her into.
    case "email_tarik": {
      const text = strArg(body.text, 4000);
      if (!text) {
        return { ok: false, message: "There's nothing in the email — what should it say?" };
      }
      const subject = strArg(body.subject, 200) ?? "From Zola";

      const sent = await emailOwner(subject, text);
      if (!sent.ok) {
        // Said out loud, with the reason. A mail she thinks she sent and he
        // never got is the failure this whole path is shaped around.
        return { ok: false, message: `I couldn't send that — ${sent.reason}.` };
      }

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "email_tarik",
      });
      return {
        ok: true,
        message: `Sent — "${subject}", from my address to yours.`,
        data: { subject },
      };
    }

    // And this one drafts. It reaches the drafts resource and stops; there is
    // no release path anywhere in the tool surface, the same way there is no
    // send path for Gmail.
    case "draft_reply": {
      const text = strArg(body.text, 4000);
      if (!text) {
        return { ok: false, message: "Tell me what the reply should say first." };
      }
      const match = strArg(body.reply_match, 200);
      if (!match) {
        return { ok: false, message: "Which message should I answer? Name the sender or the subject." };
      }

      let inbox;
      try {
        inbox = await listMessages(30);
      } catch (err) {
        const why = err instanceof AgentMailError ? `AgentMail answered ${err.status}` : "something went wrong";
        return { ok: false, message: `I couldn't read my inbox to find that — ${why}.` };
      }

      const target = pickReplyTarget(inbox, match);
      if (target.outcome === "none") {
        return {
          ok: false,
          outcome: "no_match",
          message: `Nothing in my inbox matches "${match}", so I haven't drafted anything.`,
        };
      }
      if (target.outcome === "ambiguous") {
        // Never a guess. A wrong guess here is a real letter waiting to go to a
        // real stranger, and he would be releasing it on my word.
        const names = target.candidates.map((m) => summarize(m)).join(" ");
        return {
          ok: false,
          outcome: "ambiguous",
          message: `A few could be it — ${names} Which one? Nothing drafted yet.`,
        };
      }

      const drafted = await createReplyDraft(
        target.to,
        target.subject,
        text,
        target.inReplyTo,
      );
      if (!drafted.ok) {
        return { ok: false, message: `I couldn't save that draft — ${drafted.reason}.` };
      }

      await convex.mutation(api.secondBrain.markToolHealthyFromTool, {
        secret,
        name: "draft_reply",
      });
      return {
        ok: true,
        message: `Drafted to ${target.to} — "${target.subject}". It's waiting in my drafts and won't go anywhere until you send it.`,
        data: { draftId: drafted.draftId, to: target.to, subject: target.subject },
      };
    }

    default:
      return { ok: false, message: `Unknown tool: ${tool}` };
  }
}
