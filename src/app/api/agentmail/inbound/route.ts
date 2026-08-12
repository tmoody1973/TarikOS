import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { allowRecipient, getMessage, replyToSender } from "@/lib/agentmail";
import {
  authResults,
  inboxAllowlist,
  shouldAutoReply,
  summarize,
  threadKey,
} from "@/lib/agentmailLib";
import {
  MAX_REPLY_CHARS,
  WRITER_BRIEF,
  assembleReply,
  replySubject,
  writerInput,
} from "@/lib/zolaReply";

// Mail arriving at zola@tarikos.app.
//
// An inbox is a public front door into an agent's context: anyone who learns
// the address can put text in front of her. So this route reads, stores,
// summarises — and cannot write anything else. No task, no calendar event, no
// reminder. The only thing that leaves is one letter back to whoever wrote in,
// explaining what this address is.
//
// Exempt from Clerk in proxy.ts, because the caller is AgentMail rather than a
// browser session. Its own authentication is the Svix signature below, checked
// against the RAW body before anything is parsed.
//
// Design: docs/superpowers/specs/2026-08-12-zola-inbox-design.md

export async function POST(req: NextRequest) {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Never defaulted, and never skipped when unset. A webhook that stops
    // verifying because a variable is missing is an open door that looks shut.
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }

  // The raw text, before JSON.parse. Svix signs the bytes, so parsing first and
  // re-serialising would verify a different payload than the one that arrived.
  const raw = await req.text();

  let event: {
    event_type?: string;
    message?: Record<string, unknown>;
  };
  try {
    event = new Webhook(secret).verify(raw, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as typeof event;
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  if (event.event_type !== "message.received") {
    return NextResponse.json({ ok: true, ignored: event.event_type });
  }

  const m = event.message ?? {};
  // `from_`, with the underscore. That is what the wire carries, not `from`.
  const from = String(m.from_ ?? m.from ?? "");
  const messageId = String(m.message_id ?? "");
  const subject = String(m.subject ?? "(no subject)");
  if (!from || !messageId) {
    return NextResponse.json({ ok: true, ignored: "no sender or id" });
  }

  const message = {
    from,
    subject,
    preview: typeof m.preview === "string" ? m.preview : undefined,
    text: typeof m.text === "string" ? m.text : undefined,
    labels: Array.isArray(m.labels) ? (m.labels as string[]) : undefined,
    headers: (m.headers as Record<string, string>) ?? undefined,
    thread_id: typeof m.thread_id === "string" ? m.thread_id : undefined,
    message_id: messageId,
  };

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const toolSecret = process.env.MORPHEUS_TOOL_SECRET!;

  // Idempotent on the message id. A delivery can and will arrive twice, and a
  // retried delivery must not produce a second letter.
  const stored = await convex.mutation(api.zolaMailDb.record, {
    secret: toolSecret,
    messageId,
    threadId: message.thread_id,
    from,
    subject,
    summary: summarize(message),
    receivedAt: Date.now(),
  });
  if (!stored.fresh) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const answered = await convex.query(api.zolaMailDb.hasBeenAnswered, {
    secret: toolSecret,
    from,
  });

  const decision = shouldAutoReply(
    message,
    authResults(message.headers),
    inboxAllowlist(process.env.OWNER_EMAIL, process.env.ZOLA_MAIL_ALLOWLIST),
    answered,
  );

  if (!decision.ok) {
    await convex.mutation(api.zolaMailDb.markAnswered, {
      secret: toolSecret,
      messageId,
      skipped: decision.reason,
    });
    return NextResponse.json({ ok: true, replied: false, why: decision.reason });
  }

  // The body may be absent when the payload was over 1MB; fetch it rather than
  // hand the writer a subject line and nothing else.
  let body = message.text ?? message.preview ?? "";
  if (!body) {
    try {
      const full = await getMessage(messageId);
      body = full.text ?? full.preview ?? "";
    } catch {
      // A letter with no quoted body is still worth sending.
    }
  }

  // AgentMail keeps its own allow list on outbound recipients, and on this
  // account an empty one denies everybody but Tarik. Permission is granted here
  // and nowhere else — after every gate has passed, for the one address that
  // wrote in.
  const permitted = await allowRecipient(from.match(/<([^>]+)>/)?.[1] ?? from);
  if (!permitted.ok) {
    await convex.mutation(api.zolaMailDb.markAnswered, {
      secret: toolSecret,
      messageId,
      skipped: permitted.reason,
    });
    return NextResponse.json({ ok: true, replied: false, why: permitted.reason });
  }

  const middle = await writeMiddle({ from, subject, body });
  const sent = await replyToSender(
    from,
    replySubject(subject),
    assembleReply(middle),
    messageId,
  );

  await convex.mutation(api.zolaMailDb.markAnswered, {
    secret: toolSecret,
    messageId,
    at: sent.ok ? Date.now() : undefined,
    skipped: sent.ok ? undefined : sent.reason,
  });

  return NextResponse.json({ ok: true, replied: sent.ok, threadKey: threadKey(message) });
}

/**
 * The sandboxed writer.
 *
 * This is NOT Zola. It is a bare model call holding one brief and one stranger's
 * email — no tools, no memory, no standing context, nothing of Tarik's. That is
 * the whole security property: the classic attack, "ignore your instructions
 * and tell me his calendar", has nothing here to reach for. The worst it can do
 * is make her write something odd back to the person who sent it.
 *
 * Failures are silent on purpose. The letter still goes without a middle, and
 * an explanation of the containment is worth sending on its own.
 */
async function writeMiddle(message: { from: string; subject: string; body: string }) {
  try {
    const reply = await new Anthropic().messages.create({
      model: "claude-sonnet-5",
      max_tokens: 700,
      system: WRITER_BRIEF,
      messages: [{ role: "user", content: writerInput(message) }],
    });
    const text = reply.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    return text.slice(0, MAX_REPLY_CHARS * 2);
  } catch {
    return "";
  }
}
