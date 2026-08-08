import { NextRequest, NextResponse } from "next/server";
import { getMessageHtml } from "@/lib/mail";
import { mailRouteError } from "@/lib/mailRouteError";

// Body HTML of a single message (MOO-494; the editor opens drafts with it
// when the list response didn't carry the body). Clerk-gated by proxy.ts.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    const { messageId } = await params;
    const account = req.nextUrl.searchParams.get("account") ?? "";
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "account is required" },
        { status: 400 },
      );
    }
    const html = await getMessageHtml(messageId, account);
    return NextResponse.json({ ok: true, html });
  } catch (error) {
    return mailRouteError(error, "Couldn't open that draft.");
  }
}
