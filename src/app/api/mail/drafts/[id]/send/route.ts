import { NextRequest, NextResponse } from "next/server";
import { sendDraft } from "@/lib/mail";
import { mailRouteError } from "@/lib/mailRouteError";

// The ONLY send endpoint (MOO-493): explicit, draft-first, Clerk-gated by
// proxy.ts. A failed send leaves the draft in Gmail (SEND_DRAFT is atomic).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const account = typeof body.account === "string" ? body.account : undefined;
    await sendDraft(id, account);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mailRouteError(error, "Send failed — the draft is still in Gmail.");
  }
}
