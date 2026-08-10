import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { isAllowedChat, secretMatches } from "@/lib/telegramAllowlist";
import { buildGoalsSection } from "../../../../../convex/telosLib";
import { TEXT_TOOLS } from "@/lib/textTools";
import { sendToChat, TELEGRAM_TAGS } from "@/lib/telegram";

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

/**
 * How many times Claude may call a tool and think again before answering.
 *
 * A cap rather than a while-loop: a model that keeps reaching for one more
 * lookup would otherwise hold the webhook open until Vercel kills it, and
 * Telegram would redeliver the same message into the same spiral. Four is
 * enough for "check my calendar, then my mail, then answer".
 */
const MAX_TOOL_ROUNDS = 4;

/**
 * Run one of Zola's tools — the same HTTP webhook the ElevenLabs runtime
 * calls, with the same shared secret. There is no second implementation of a
 * tool anywhere: voice and text go through one door.
 */
async function runTool(
  origin: string,
  name: string,
  input: unknown,
  secret: string,
): Promise<string> {
  const res = await fetch(new URL(`/api/tools/${name}`, origin), {
    method: "POST",
    headers: { "content-type": "application/json", "x-morpheus-secret": secret },
    body: JSON.stringify(input ?? {}),
  });
  const body = await res.text();
  // Handed to the model as-is: the route already answers with a spoken
  // `message` on failure, which is more useful to Claude than a status code.
  return body.slice(0, 12000);
}

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin;
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

    const client = new Anthropic();
    const system =
      "You are Zola, Tarik's assistant, answering over text message. Be brief — " +
      "this is a phone screen, not a document. No preamble, no sign-off, no " +
      "markdown. Telegram renders a small HTML subset and you may use it: " +
      "<" + TELEGRAM_TAGS.split(", ").join("> <") + ">. " +
      "Write a bare less-than sign as &lt; — one of them un-escaped and the " +
      "whole message fails to send. Use your tools rather than guessing: if he asks about " +
      "his calendar, mail, goals or notes, go and look. If a tool comes back " +
      "empty or failed, say so plainly in one line.\n\nHis goals right now:\n" +
      goals;

    // Everything still in this conversation, so "what about tomorrow?" has
    // something to refer to. The window is decided in convex/telegramLib.ts by
    // the silence between messages, not by a TTL.
    const history = await convex.query(api.telegram.context, {
      secret,
      chatId: String(chatId),
    });
    const messages: Anthropic.MessageParam[] = [
      ...history.map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content,
      })),
      { role: "user", content: text },
    ];
    let answer = "";

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const reply = await client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system,
        tools: TEXT_TOOLS,
        // On the last round the tools are withheld, which forces a written
        // answer instead of a fifth tool call that would be dropped.
        ...(round === MAX_TOOL_ROUNDS ? { tool_choice: { type: "none" as const } } : {}),
        messages,
      });

      answer = reply.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const calls = reply.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (calls.length === 0) break;

      messages.push({ role: "assistant", content: reply.content });
      messages.push({
        role: "user",
        content: await Promise.all(
          calls.map(async (call) => ({
            type: "tool_result" as const,
            tool_use_id: call.id,
            content: await runTool(origin, call.name, call.input, secret),
          })),
        ),
      });
    }

    const spoken = answer || "I didn't have an answer for that.";
    await sendToChat(String(chatId), spoken);

    // Written only after the reply lands. A question that was never answered
    // should not sit in the history as though it had been, and a failed send
    // leaves the next message starting where this one did.
    await Promise.all([
      convex.mutation(api.telegram.appendTurn, {
        secret,
        chatId: String(chatId),
        role: "user",
        content: text,
      }),
      convex.mutation(api.telegram.appendTurn, {
        secret,
        chatId: String(chatId),
        role: "assistant",
        content: spoken,
      }),
    ]);
  } catch (error) {
    // Tell him something went wrong rather than leaving the message unanswered,
    // but never the error text — it can carry keys and internal paths.
    console.error(
      `telegram: reply failed — ${error instanceof Error ? error.message : "unknown"}`,
    );
    await sendToChat(
      String(chatId),
      "Something broke on my end. It's in the logs.",
    ).catch(() => {});
  }

  // Always 200 once the caller is trusted: a non-2xx makes Telegram redeliver
  // the same update, and a failed reply must not become a loop.
  return NextResponse.json({ ok: true }, { status: 200 });
}
