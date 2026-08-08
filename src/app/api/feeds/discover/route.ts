import { NextRequest, NextResponse } from "next/server";
import { discoverFeed } from "@/lib/feedDiscovery";

// Feed autodiscovery for the Control Panel paste-a-URL flow (MOO-486).
// Clerk-gated by proxy.ts. Validation happens inside discoverFeed — a
// non-null result is a real, parseable feed.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = typeof body.input === "string" ? body.input.trim() : "";
    if (!input) {
      return NextResponse.json(
        { ok: false, error: "Paste a site or feed URL first." },
        { status: 200 },
      );
    }
    const feed = await discoverFeed(input);
    if (!feed) {
      return NextResponse.json(
        { ok: false, error: `No RSS/Atom feed found at "${input}".` },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, ...feed });
  } catch (error) {
    console.error("feed discover failed:", error);
    return NextResponse.json(
      { ok: false, error: "Feed discovery hit an internal error." },
      { status: 200 },
    );
  }
}
