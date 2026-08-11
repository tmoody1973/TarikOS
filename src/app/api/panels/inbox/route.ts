import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { getRecentEmails, GoogleAuthError } from "@/lib/google";
import { api } from "../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Inbox panel data. Clerk-gated by proxy.ts (not in the public-route list).
export async function GET() {
  try {
    // The same mute list the voice path uses, read with the tool secret
    // because this runs on the server without a Convex identity. One list, or
    // the panel and the brief would disagree about what counts as noise.
    const mutes = await convex
      .query(api.mailFilters.forTools, { secret: process.env.MORPHEUS_TOOL_SECRET! })
      .catch(() => undefined);
    const emails = await getRecentEmails(mutes ?? undefined);
    return NextResponse.json({ ok: true, emails });
  } catch (error) {
    const message =
      error instanceof GoogleAuthError
        ? error.message
        : "Couldn't reach the inbox.";
    if (!(error instanceof GoogleAuthError)) {
      console.error("inbox panel failed:", error);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
