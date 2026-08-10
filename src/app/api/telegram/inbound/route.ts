import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { isAllowedChat, secretMatches } from "@/lib/telegramAllowlist";
import { buildGoalsSection } from "../../../../../convex/telosLib";

// Zola over Telegram. The keyboard channel SMS was going to be, without the
// carrier regime: no 10DLC, no brand registration, no account review, and
// outbound works the moment the bot exists.
//
// Telegram proves it sent the request with a shared secret in a plain header
// rather than a signature, so unlike the Telnyx route there is no asymmetric
// proof here — the secret is a password and is treated as one.
//
// Exempted from Clerk in proxy.ts: the caller is Telegram, not a browser.

const MODEL = "claude-opus-5";
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/** Telegram's own limit is 4096 characters per message. */
const MAX_REPLY = 3500;

async function sendMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, MAX_REPLY),
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!res.ok) {
    // The body carries Telegram's description of what was wrong, which is the
    // only useful part; it contains no user content.
    throw new Error(`telegram sendMessage ${res.status}: ${await res.text()}`);
  }
}

export async function POST(req: NextRequest) {
  // The shared secret first, before the body is parsed at all. An unset
  // TELEGRAM_WEBHOOK_SECRET refuses everything rather than accepting it —
  // a deploy that forgot the variable must fail closed, not open.
  if (
    !secretMatches(
      req.headers.get("x-telegram-bot-api-secret-token"),
      process.env.TELEGRAM_WEBHOOK_SECRET,
    )
  ) {
    console.warn("telegram: rejected a request with a bad or missing secret");
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const update = (await req.json()) as {
    message?: { chat?: { id?: unknown }; text?: unknown };
  };
  const chatId = update.message?.chat?.id;
  const text = typeof update.message?.text === "string" ? update.message.text : "";

  if (!isAllowedChat(chatId, process.env.TELEGRAM_OWNER_CHAT_ID)) {
    // Silently, and always 200: a reply of any kind confirms the bot is live
    // and answering, and Telegram retries anything that is not a 2xx.
    console.warn("telegram: dropped a message from a non-allowlisted chat");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (!text.trim()) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const secret = process.env.MORPHEUS_TOOL_SECRET ?? "";
  try {
    // Goals and mission, the same standing context the voice session opens
    // with. Read through the secret-gated query because there is no Clerk
    // session on a webhook.
    const items = await convex.query(api.telos.listItems, { secret });
    const goals = buildGoalsSection(items, Date.now());

    const reply = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: 800,
      system:
        "You are Zola, Tarik's assistant, answering over text message. Be brief — " +
        "this is a phone screen, not a document. No preamble, no sign-off, no " +
        "markdown headers. If you do not know something, say so in one line rather " +
        "than guessing.\n\nWhat you know about his goals right now:\n" +
        goals,
      messages: [{ role: "user", content: text }],
    });

    const answer = reply.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    await sendMessage(String(chatId), answer || "I didn't have an answer for that.");
  } catch (error) {
    // Tell him something went wrong rather than leaving the message unanswered,
    // but never the error text — it can carry keys and internal paths.
    console.error(
      `telegram: reply failed — ${error instanceof Error ? error.message : "unknown"}`,
    );
    await sendMessage(
      String(chatId),
      "Something broke on my end. It's in the logs.",
    ).catch(() => {});
  }

  // Always 200 once the caller is trusted: a non-2xx makes Telegram redeliver
  // the same update, and a failed reply must not become a loop.
  return NextResponse.json({ ok: true }, { status: 200 });
}
