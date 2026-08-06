import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import {
  getCalendarEvents,
  getRecentEmails,
  GoogleAuthError,
} from "@/lib/google";

// Webhook endpoint for Morpheus's ElevenLabs server tools. Authenticated by
// a shared secret header (configured on the agent), not a browser session —
// proxy.ts exempts /api/tools from Clerk.
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

type ToolResult = { ok: boolean; message: string; data?: unknown };

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
    const result = await runTool(tool, body, secret);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 200 },
      );
    }
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
      const results = await convex.query(api.secondBrain.recall, {
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
    case "get_calendar": {
      const date =
        typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
          ? body.date
          : undefined;
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
    case "get_emails": {
      const emails = await getRecentEmails();
      await convex.mutation(api.secondBrain.pushBriefingCards, {
        secret,
        tool: "get_emails",
        cards: emails.slice(0, 6).map((e) => ({
          kind: "email" as const,
          title: e.subject || "(no subject)",
          body: `${e.from} · ${e.account} — ${e.snippet.slice(0, 100)}`,
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
    default:
      return { ok: false, message: `Unknown tool: ${tool}` };
  }
}
