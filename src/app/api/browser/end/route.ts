import { NextRequest, NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { convexServer } from "@/lib/convexServer";
import { endBrowserSession } from "@/lib/browserSession";

// END SESSION button (MOO-485): releases the Browserbase session and marks
// the row done. Clerk-gated by proxy.ts.

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.MORPHEUS_TOOL_SECRET;
    if (!secret) throw new Error("MORPHEUS_TOOL_SECRET missing");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "sessionId required" },
        { status: 400 },
      );
    }
    // Mark done even if the release call fails: the user's intent is "kill
    // it", the guard must free up, and Browserbase reaps timed-out sessions
    // server-side anyway.
    await endBrowserSession(sessionId).catch(() => {});
    await convexServer().mutation(api.browserSessions.updateSession, {
      secret,
      sessionId,
      status: "done",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("browser end failed:", error);
    return NextResponse.json(
      { ok: false, error: "Couldn't end the session." },
      { status: 200 },
    );
  }
}
