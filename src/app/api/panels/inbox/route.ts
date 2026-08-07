import { NextResponse } from "next/server";
import { getRecentEmails, GoogleAuthError } from "@/lib/google";

// Inbox panel data. Clerk-gated by proxy.ts (not in the public-route list).
export async function GET() {
  try {
    const emails = await getRecentEmails();
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
