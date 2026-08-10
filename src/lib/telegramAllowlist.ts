// Who Zola answers on Telegram.
//
// A bot's username is discoverable and anyone can open a chat with it, so —
// exactly as with SMS — this list is the whole inbound access control. The
// difference is that Telegram identifies people by a numeric chat id rather
// than a phone number, which is both more stable and easier to get wrong:
// ids are large integers that arrive as numbers in JSON and are configured as
// strings in an env var.
//
// Pure and dependency-free so the rule can be tested without a webhook.

/** One canonical string form, or "" if it isn't a usable id. */
export function normalizeChatId(value: unknown): string {
  if (typeof value === "number") {
    // Telegram ids exceed 2^32 and JSON numbers are doubles; anything that
    // isn't an exact integer has already lost precision and must not be
    // trusted as an identity.
    return Number.isSafeInteger(value) ? String(value) : "";
  }
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  // Negative ids are groups and supergroups, which are legitimate chats.
  return /^-?\d+$/.test(trimmed) ? trimmed : "";
}

/**
 * Exact match, and fails closed when no owner is configured.
 *
 * An unset TELEGRAM_OWNER_CHAT_ID in production must not turn the bot into an
 * open line to an assistant holding Tarik's calendar, mail and second brain.
 */
export function isAllowedChat(
  chatId: unknown,
  owner: string | null | undefined,
): boolean {
  const expected = normalizeChatId(owner);
  if (!expected) return false;
  const actual = normalizeChatId(chatId);
  if (!actual) return false;
  return actual === expected;
}

/**
 * Constant-time-ish comparison for the webhook secret.
 *
 * Telegram sends the shared secret as a plain header, so this is a password
 * comparison, not a signature check — there is no asymmetric proof the way
 * Telnyx gives one. Length is compared first because the strings are
 * configured, not attacker-sized.
 */
export function secretMatches(
  supplied: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  if (typeof supplied !== "string") return false;
  if (supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  return diff === 0;
}
