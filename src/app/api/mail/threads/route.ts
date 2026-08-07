import { NextRequest, NextResponse } from "next/server";
import { listMailThreads } from "@/lib/mail";
import { mailRouteError } from "@/lib/mailRouteError";

// Mail thread list. Clerk-gated by proxy.ts (not in the public-route list).
export async function GET(req: NextRequest) {
  try {
    const account = req.nextUrl.searchParams.get("account") ?? undefined;
    const data = await listMailThreads(account);
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return mailRouteError(error, "Couldn't reach the mailbox.");
  }
}
