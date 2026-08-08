import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { convexServer } from "@/lib/convexServer";
import { createBrowserSession, endBrowserSession } from "@/lib/browserSession";

// Blank manual session for the Viewport rail button (MOO-485). Clerk-gated
// by proxy.ts — Tarik-driven browsing, no agent involved. startSession's
// insert is the atomic one-at-a-time guard.
export async function POST() {
  try {
    const secret = process.env.MORPHEUS_TOOL_SECRET;
    if (!secret) throw new Error("MORPHEUS_TOOL_SECRET missing");
    const session = await createBrowserSession();
    try {
      await convexServer().mutation(api.browserSessions.startSession, {
        secret,
        sessionId: session.sessionId,
        status: "idle",
        liveViewUrl: session.liveViewUrl,
        replayUrl: session.replayUrl,
      });
    } catch {
      await endBrowserSession(session.sessionId).catch(() => {});
      return NextResponse.json(
        { ok: false, error: "A session is already open — end it first." },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("browser start failed:", error);
    return NextResponse.json(
      { ok: false, error: "Couldn't open a browser session." },
      { status: 200 },
    );
  }
}
