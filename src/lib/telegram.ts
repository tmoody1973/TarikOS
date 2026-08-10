// Sending to Telegram. One door, and it opens onto exactly one chat.
//
// There is deliberately NO destination parameter, the same shape as
// call_tarik: the chat comes from TELEGRAM_OWNER_CHAT_ID on the server, so
// nothing in a request body — and nothing a model decides — can redirect a
// message to someone else. A prompt can be argued with; a parameter that does
// not exist cannot. tests/telegramSendGuardrail.test.ts scans for this.

/** Telegram's own limit is 4096 characters per message. */
export const MAX_REPLY = 3500;

/**
 * Tags Telegram accepts, verified against the live API rather than the docs
 * (the formatting page would not fetch). `<h1>` is rejected outright, and so
 * is a BARE `<` anywhere in the text — "5 < 7" in ordinary prose kills the
 * whole message with "Unsupported start tag". A bare `&` is fine.
 */
export const TELEGRAM_TAGS = "b, i, code, pre, s, u, a, blockquote";

/**
 * Text that is not markup, made safe to put inside a message.
 *
 * A bare `<` rejects the WHOLE message, so any string the app did not author —
 * an agent's error text, a brief title, a subject line — has to be escaped
 * before it is interpolated. The fallback would catch it, but the fallback
 * costs the formatting of everything around it.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Everything Telegram would try to parse, removed. */
function stripTags(html: string): string {
  return html
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function post(
  token: string,
  chatId: string,
  text: string,
  html: boolean,
): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, MAX_REPLY),
      ...(html ? { parse_mode: "HTML" } : {}),
      link_preview_options: { is_disabled: true },
    }),
  });
}

/**
 * Send as HTML, and fall back to plain text if Telegram refuses to parse it.
 *
 * The fallback is not defensive padding: a single stray `<` from the model —
 * "under 5 < 7 items" — makes Telegram reject the message entirely, and the
 * failure mode without this is that he asks a question and gets silence. One
 * ugly message beats no message.
 */
export async function sendToChat(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const res = await post(token, chatId, text, true);
  if (res.ok) return;

  const detail = await res.text();
  if (!detail.includes("can't parse entities")) {
    throw new Error(`telegram sendMessage ${res.status}: ${detail}`);
  }

  console.warn("telegram: HTML rejected, resending as plain text");
  const plain = await post(token, chatId, stripTags(text), false);
  if (!plain.ok) {
    throw new Error(`telegram sendMessage ${plain.status}: ${await plain.text()}`);
  }
}


/**
 * Send to the owner, and only the owner.
 *
 * The one function every proactive sender uses — the tool route, the takeover
 * ping, the brief digest. Returns false rather than throwing when Telegram is
 * not configured: a missing notification must never take down the workflow
 * that was trying to send it.
 */
export async function notifyOwner(text: string): Promise<boolean> {
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return false;
  try {
    await sendToChat(chatId, text);
    return true;
  } catch (error) {
    console.error(
      `telegram: notify failed — ${error instanceof Error ? error.message : "unknown"}`,
    );
    return false;
  }
}
