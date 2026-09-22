import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import {
  buildLiveSessionConfig,
  DEFAULT_VOICE,
  isLiveVoice,
  STANDING_CONTEXT_MAX_CHARS,
} from "@/lib/voice/liveSession";

/* Starts a GPT-Live WebRTC session for the signed-in browser.
 *
 * The browser sends its SDP offer (the WebRTC handshake). This route hands it
 * to OpenAI with the project key and the session config, and returns the SDP
 * answer plus the session id. The key never reaches the browser, and the HTTP
 * request is what starts the session: the browser must not send session.start.
 *
 * Creating a WebRTC session bills 15 seconds up front, credited back once the
 * session runs. See docs/new-feat-research/2026-09-22-gpt-live-migration-plan.md. */

const MAX_SDP_BYTES = 64 * 1024;

export async function POST(req: Request) {
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
  const { sdp, voice = DEFAULT_VOICE, standingContext } = (body ?? {}) as {
    sdp?: unknown;
    voice?: unknown;
    standingContext?: unknown;
  };
  if (typeof sdp !== "string" || !sdp.trim() || sdp.length > MAX_SDP_BYTES) {
    return NextResponse.json(
      { error: "An SDP offer is required" },
      { status: 400 },
    );
  }
  if (!isLiveVoice(voice)) {
    return NextResponse.json({ error: "Unknown voice" }, { status: 400 });
  }
  if (
    standingContext !== undefined &&
    (typeof standingContext !== "string" ||
      standingContext.length > STANDING_CONTEXT_MAX_CHARS)
  ) {
    return NextResponse.json(
      { error: "standingContext must be a string within the size limit" },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 },
    );
  }

  try {
    const client = new OpenAI({ maxRetries: 0 });
    const result = await client.live.create({
      session: buildLiveSessionConfig({ voice, standingContext }),
      transport: { type: "webrtc", sdp },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof OpenAI.APIError ? (error.status ?? 502) : 502;
    console.error("Live session creation failed:", error);
    return NextResponse.json(
      { error: "Live session creation failed" },
      { status },
    );
  }
}
