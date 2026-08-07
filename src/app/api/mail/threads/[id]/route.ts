import { NextRequest, NextResponse } from "next/server";
import { getMailThread } from "@/lib/mail";
import { GoogleAuthError } from "@/lib/google";

// Full thread read (sanitized server-side). Clerk-gated by proxy.ts.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const account = req.nextUrl.searchParams.get("account") ?? "";
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "account is required" },
        { status: 400 },
      );
    }
    const messages = await getMailThread(id, account);
    return NextResponse.json({ ok: true, messages });
  } catch (error) {
    const message =
      error instanceof GoogleAuthError
        ? error.message
        : "Couldn't load that thread.";
    if (!(error instanceof GoogleAuthError)) {
      console.error("mail thread failed:", error);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
