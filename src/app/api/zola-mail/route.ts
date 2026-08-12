import { NextRequest, NextResponse } from "next/server";
import { getMessage, listMessages } from "@/lib/agentmail";
import {
  allowedSender,
  inboxAllowlist,
  isForwarded,
  received,
  summarize,
  unreadCount,
} from "@/lib/agentmailLib";

// Zola's inbox, for her tab at /mail/zola. Clerk-gated by proxy.ts, like every
// other /api/mail route — this is Tarik looking at her mailbox, not the agent
// reading it.
//
// The surface shows EVERYTHING, including senders nobody allowlisted. That is
// the point of the rule as revised: the allowlist governs what reaches her
// reasoning automatically, not what is stored or what he is allowed to see.
// Each row says which side of that line it sits on.
// docs/superpowers/specs/2026-08-12-zola-inbox-design.md

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  try {
    if (id) {
      const message = await getMessage(id);
      return NextResponse.json({
        ok: true,
        message: {
          from: message.from,
          subject: message.subject ?? "(no subject)",
          timestamp: message.timestamp ?? "",
          text: message.text ?? message.preview ?? "",
          forwarded: isForwarded(message),
        },
      });
    }

    const messages = received(await listMessages(50));
    const allowlist = inboxAllowlist(
      process.env.OWNER_EMAIL,
      process.env.ZOLA_MAIL_ALLOWLIST,
    );
    return NextResponse.json({
      ok: true,
      unread: unreadCount(messages),
      messages: messages.map((m) => ({
        id: m.message_id ?? "",
        from: m.from,
        subject: m.subject ?? "(no subject)",
        // The list endpoint carries no body, so this is the preview with the
        // signature block cut off — the same line she would say out loud.
        summary: summarize(m),
        timestamp: m.timestamp ?? "",
        unread: (m.labels ?? []).includes("unread"),
        listed: allowedSender(m.from, allowlist),
        forwarded: isForwarded(m),
      })),
    });
  } catch (error) {
    // Named plainly. "Her inbox is empty" would be a lie about a missing key.
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Couldn't reach her inbox.",
      },
      { status: 502 },
    );
  }
}
