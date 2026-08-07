import { NextRequest, NextResponse } from "next/server";
import { createDraft, listDrafts, replaceDraft } from "@/lib/mail";
import { mailRouteError } from "@/lib/mailRouteError";

// Gmail-native drafts (MOO-493). Clerk-gated by proxy.ts (not public).
// POST creates a draft; with replaceDraftId it replaces (delete + create —
// Composio has no update action). threadId makes it a draft-first reply.

export async function GET(req: NextRequest) {
  try {
    const account = req.nextUrl.searchParams.get("account") ?? undefined;
    const drafts = await listDrafts(account);
    return NextResponse.json({ ok: true, drafts });
  } catch (error) {
    return mailRouteError(error, "Couldn't load drafts.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const to = typeof body.to === "string" ? body.to.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject : "";
    const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json(
        { ok: false, error: "Recipient must be a valid email address." },
        { status: 200 },
      );
    }
    const input = {
      to,
      subject,
      bodyHtml,
      account: typeof body.account === "string" ? body.account : undefined,
      threadId: typeof body.threadId === "string" ? body.threadId : undefined,
    };
    const replaceId =
      typeof body.replaceDraftId === "string" ? body.replaceDraftId : undefined;
    const result = replaceId
      ? await replaceDraft(replaceId, input)
      : await createDraft(input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return mailRouteError(
      error,
      "Draft save failed — your content is still in the editor.",
    );
  }
}
