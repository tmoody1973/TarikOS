import { NextRequest, NextResponse } from "next/server";
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
import { safeSlice } from "../../../../../convex/workflowLib";
import {
  TELOS_KINDS,
  TELOS_STATUSES,
  buildGoalsSection,
  buildJournalDigest,
  type TelosKind,
  type TelosStatus,
} from "../../../../../convex/telosLib";
import type { Id } from "../../../../../convex/_generated/dataModel";

// Webhook endpoint for Zola's ElevenLabs server tools. Authenticated by
// a shared secret header (configured on the agent), not a browser session —
// proxy.ts exempts /api/tools from Clerk.
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

type ToolResult = { ok: boolean; message: string; data?: unknown };

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

  try {
    const gate = await convex.query(api.secondBrain.toolGate, {
      secret,
      name: tool,
    });
    if (!gate.allowed) {
      return NextResponse.json(
        {
          ok: false,
          message: `The ${tool.replace(/_/g, " ")} tool is disabled in the control panel, so it can't be used right now.`,
        },
        { status: 200 },
      );
    }
    const result = await runTool(tool, body, secret);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
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

async function runTool(
  tool: string,
  body: Record<string, unknown>,
  secret: string,
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
      const count = results.thoughts.length + results.memories.length;
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
          message: `No timed event matching "${match}" on ${date}. Ask Tarik which event he means (all-day events can't be moved yet).`,
        };
      }
      if (res.outcome === "ambiguous") {
        return {
          ok: true,
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
      const emails = await getRecentEmails();
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
          body: `${r.snippet}${r.url ? ` — ${r.url}` : ""}`,
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
    case "get_rss": {
      const feeds =
        typeof body.feeds === "string"
          ? body.feeds.split(/\s+/).filter(Boolean)
          : [];
      if (feeds.length === 0) {
        return { ok: false, message: "get_rss needs a feeds list." };
      }
      const results = await fetchFeedGroup(feeds);
      await convex.mutation(api.secondBrain.pushBriefingCards, {
        secret,
        tool: "get_rss",
        cards: results.slice(0, 4).map((r) => ({
          kind: "research" as const,
          title: r.title,
          body: `${r.snippet}${r.url ? ` — ${r.url}` : ""}`,
        })),
      });
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
        message: `Brief "${brief.title}" is ready with ${brief.sections.length} section(s). Speak from its sections.`,
        data: {
          title: brief.title,
          builtAt: brief.runStartedAt,
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
          message: `No active telos item matches "${match}". Ask Tarik which item he means.`,
        };
      }
      if (res.outcome === "ambiguous") {
        return {
          ok: true,
          message: `Several items match — ask Tarik which one: ${res.candidates.join("; ")}.`,
        };
      }
      return {
        ok: true,
        message: `Updated: ${res.item.text} (${res.item.status}).`,
      };
    }
    default:
      return { ok: false, message: `Unknown tool: ${tool}` };
  }
}
