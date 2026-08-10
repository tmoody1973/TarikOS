// Who Zola answers on SMS (MOO-497).
//
// The number is public by construction: anyone who learns it can text it, and
// unlike /f/<slug> there is no secret in the address. This list is therefore
// the whole inbound access control, standing between a stranger and an agent
// wired to Tarik's calendar, mail and second brain.
//
// Kept pure and dependency-free so the rule can be tested directly rather than
// through a webhook, the way documentsLib's rules are.

/**
 * A phone number in one canonical form, or "" if it isn't one.
 *
 * Both sides need normalising, not just the inbound one: Telnyx sends E.164,
 * but OWNER_PHONE is hand-typed and a human writes a number however they think
 * of it. A gate that refused `(414) 555-1212` would look like a broken
 * integration rather than a policy.
 *
 * Ten digits are assumed to be US and gain a +1 — Tarik types ten. Anything
 * already carrying a country code keeps it.
 */
export function normalizeE164(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  // 11 to 15 digits is the E.164 range once a country code is present.
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

/**
 * Exact match after normalising, never a suffix match.
 *
 * Suffix matching is the tempting shortcut and it is wrong twice over: a short
 * number ending in the same digits would pass, and so would the same digits in
 * another country.
 *
 * Fails closed when no owner is configured. An unset OWNER_PHONE in production
 * must not turn the number into an open line.
 */
export function isAllowedSender(
  from: string | null | undefined,
  owner: string | null | undefined,
): boolean {
  const expected = normalizeE164(owner);
  if (!expected) return false;
  const sender = normalizeE164(from);
  if (!sender) return false;
  return sender === expected;
}
