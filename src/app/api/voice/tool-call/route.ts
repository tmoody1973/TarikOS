import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { callTool } from "@/lib/toolCall";
import { LIVE_TOOLS } from "@/lib/voice/liveTools.generated.ts";
import { BROWSER_TOOLS } from "@/lib/voice/liveToolTypes.ts";

/* The browser's side of GPT-Live tool execution.
 *
 * The backend model picks a tool; the browser receives the call on the WebRTC
 * data channel and forwards it here. This route calls the existing
 * /api/tools/<name> webhook with the server-held secret, exactly as the
 * Telegram route does, so the enable toggle, health marking, tracing and error
 * handling in that route stay the single door for every tool. The secret never
 * reaches the browser. See docs/new-feat-research/2026-09-22-gpt-live-migration-plan.md. */

const SERVER_TOOLS = new Set(
  LIVE_TOOLS.map((t) => t.name).filter((n) => !BROWSER_TOOLS.has(n)),
);
function isServerTool(name: unknown): name is string {
  return typeof name === "string" && SERVER_TOOLS.has(name);
}

export async function POST(req: NextRequest) {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { name, arguments: args } = (body ?? {}) as {
    name?: unknown;
    arguments?: unknown;
  };
  if (!isServerTool(name)) {
    return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
  }
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    return NextResponse.json({ error: "arguments must be an object" }, { status: 400 });
  }

  const secret = process.env.MORPHEUS_TOOL_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "MORPHEUS_TOOL_SECRET not configured" },
      { status: 503 },
    );
  }

  try {
    const text = await callTool(req.nextUrl.origin, name, args, secret);
    return new NextResponse(text, { headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error(`voice tool-call ${name} failed:`, error);
    return NextResponse.json({ ok: false, message: `The ${name} tool could not be reached.` });
  }
}
