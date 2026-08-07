import { NextResponse } from "next/server";
import { getCalendarEvents, GoogleAuthError } from "@/lib/google";

// Today panel data. Clerk-gated by proxy.ts (not in the public-route list).
export async function GET() {
  try {
    const data = await getCalendarEvents();
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    const message =
      error instanceof GoogleAuthError
        ? error.message
        : "Couldn't reach the calendar.";
    if (!(error instanceof GoogleAuthError)) {
      console.error("calendar panel failed:", error);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
