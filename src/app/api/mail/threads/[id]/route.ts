import { NextRequest, NextResponse } from "next/server";
import { getMailThread } from "@/lib/mail";
import { mailRouteError } from "@/lib/mailRouteError";

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
    return mailRouteError(error, "Couldn't load that thread.");
  }
}
