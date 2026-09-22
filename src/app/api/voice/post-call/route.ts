import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { waitUntil } from "@vercel/functions";
import { emitConversationSpans } from "@/lib/emitSpans";
import { livePostCallSchema, mapLiveCall } from "@/lib/voice/livePostCall";

/* GPT-Live has no post-call webhook. The browser saw every event and ran
 * every tool, so it posts the timeline here when the session closes, and the
 * same conversation trace the ElevenLabs webhook used to produce ships to
 * Phoenix. Clerk-gated: only Tarik's browser can file a conversation.
 *
 * Acknowledge first, ship after. Observability is never load-bearing. */

const MAX_BODY_BYTES = 512 * 1024;

export async function POST(req: Request) {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = livePostCallSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Not a live post-call payload" }, { status: 400 });
  }
  const root = mapLiveCall(parsed.data);
  waitUntil(Promise.resolve().then(() => emitConversationSpans(root)));
  return NextResponse.json({ received: true });
}
