import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { waitUntil } from "@vercel/functions";
import { mapPostCall, shouldProcess } from "@/lib/phoenixMapper";
import { emitConversationSpans } from "@/lib/emitSpans";

// ElevenLabs post-call webhook. Every conversation arrives here after it ends,
// carrying the full transcript with tool_calls already attached to the turn
// that produced them — the correlation that makes tool-selection eval possible.
//
// Authenticated by ElevenLabs signature, not a browser session, so proxy.ts
// exempts /api/elevenlabs from Clerk the same way it exempts /api/tools.
//
// Returns 200 as soon as the signature checks out; shipping to Phoenix happens
// after the response via waitUntil. A slow or dead Phoenix must never make
// ElevenLabs retry into a broken backend, and observability must never be
// load-bearing for the thing it observes.

export async function POST(req: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const signature = req.headers.get("elevenlabs-signature");

  if (!shouldProcess(signature, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The raw body string is required for signature verification — parsing it
  // first would change the bytes the HMAC was computed over.
  const raw = await req.text();

  let event: unknown;
  try {
    const elevenlabs = new ElevenLabsClient();
    event = await elevenlabs.webhooks.constructEvent(raw, signature!, secret!);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const root = mapPostCall(event);
  if (!root) {
    // Not a transcription event, or a shape we do not map. Acknowledge rather
    // than error — a 4xx here would trigger retries that can never succeed.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  waitUntil(Promise.resolve().then(() => emitConversationSpans(root)));

  return NextResponse.json({ received: true }, { status: 200 });
}
