import { NextRequest, NextResponse } from "next/server";
import { listMailThreads } from "@/lib/mail";
import { GoogleAuthError } from "@/lib/google";

// Mail thread list. Clerk-gated by proxy.ts (not in the public-route list).
export async function GET(req: NextRequest) {
  try {
    const account = req.nextUrl.searchParams.get("account") ?? undefined;
    const data = await listMailThreads(account);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    const message =
      error instanceof GoogleAuthError
        ? error.message
        : "Couldn't reach the mailbox.";
    if (!(error instanceof GoogleAuthError)) {
      console.error("mail threads failed:", error);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
