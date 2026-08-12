// The rules for Zola's own inbox, with no network in them.
//
// zola@tarikos.app is a public front door into an agent's context: anyone who
// learns the address can put text in front of her. So the controls are
// structural rather than prompt-level, and they live here where they can be
// tested directly — the shape of smsAllowlist.ts and telegramAllowlist.ts,
// which draw the same line for SMS and Telegram.
//
// Design: docs/superpowers/specs/2026-08-12-zola-inbox-design.md
import { extractEmailAddress } from "./emailAddress.ts";

/** As much of an AgentMail message as any rule here needs. */
export type MailMessage = {
  from: string;
  subject?: string;
  /** AgentMail's own cut of the message, which stops at the signature. */
  preview?: string;
  text?: string;
  labels?: string[];
  thread_id?: string;
  message_id?: string;
  timestamp?: string;
};

/** A From header reduced to a bare, comparable address. */
function address(from: string | null | undefined): string {
  return (extractEmailAddress(from ?? "") ?? "").trim().toLowerCase();
}

/**
 * The allowlist, from one comma-separated environment variable.
 *
 * Unset parses to nothing, never to everyone. An empty list is a closed door,
 * which is the only safe reading of "nobody has configured this yet".
 */
export function parseAllowlist(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The whole allowlist for her inbox, assembled in one place.
 *
 * Tarik is on it by construction. OWNER_EMAIL already names him to every other
 * gate in the system, and making him retype it into a second variable is a way
 * to end up with an inbox that ignores its own owner. ZOLA_MAIL_ALLOWLIST adds
 * anyone else; unset means only him, never everyone.
 */
export function inboxAllowlist(
  owner: string | null | undefined,
  extra: string | null | undefined,
): string[] {
  return parseAllowlist([owner, extra].filter(Boolean).join(","));
}

/**
 * Whether this sender's mail reaches her reasoning context automatically.
 *
 * Note what this does NOT decide: storage. Unlisted mail is still stored and
 * still readable when Tarik asks for it by name — a confirmation from a service
 * she signed up with arrives from a sender nobody listed, and dropping it would
 * be the wrong kind of strict. What the allowlist buys is that a stranger never
 * gets summarised into the morning brief on their own initiative.
 *
 * Exact match after normalising, never a suffix match: notradiomilwaukee.org
 * ends in radiomilwaukee.org.
 */
export function allowedSender(from: string | null | undefined, allowlist: string[]): boolean {
  const sender = address(from);
  if (!sender) return false;
  return allowlist.some((allowed) => allowed.trim().toLowerCase() === sender);
}

const SUMMARY_CHARS = 220;

// The sig-dash convention: a line of exactly "--" or "-- ". AgentMail's preview
// is a fixed-length cut rather than a semantic one, so on a real email it runs
// straight past this into the job title and the playlist links.
const SIGNATURE = /\n\s*--\s*\n/;

/**
 * One line about a message, built from `preview` rather than `text`.
 *
 * The first real email into this inbox was 20.9 KB, of which roughly two
 * percent was content: a single line, then a signature block carrying phone
 * numbers, social links and a playlist. AgentMail's own `preview` already cuts
 * at the signature boundary, so summarising `text` would make every summary of
 * a real email mostly signature.
 *
 * Quoted as what an email SAID, never as something Zola concluded.
 */
export function summarize(message: MailMessage): string {
  const raw = message.preview || message.text || "";
  const body = raw.split(SIGNATURE)[0].replace(/\s+/g, " ").trim() || raw.replace(/\s+/g, " ").trim();
  const gist = body.length > SUMMARY_CHARS ? `${body.slice(0, SUMMARY_CHARS).trimEnd()}…` : body;
  const subject = (message.subject || "(no subject)").trim();
  const who = address(message.from) || "an unknown sender";
  return gist ? `${who} — "${subject}": ${gist}` : `${who} — "${subject}"`;
}

// "Fwd:", "FW:", "Fw:" — every client writes it differently, and a leading
// "Re:" chain can sit in front of it.
const FORWARD_SUBJECT = /(^|\s)(fwd?|fw)\s*:/i;
const FORWARD_BODY = /-+\s*forwarded message\s*-+|^\s*begin forwarded message/im;

/**
 * Whether Tarik forwarded this rather than someone writing to her directly.
 *
 * It matters because a forward is his gesture, so it earns her attention — she
 * may summarise it, pull a date out of it, propose something off the back of
 * it. It does NOT make the content trustworthy. If a forwarded email says
 * "wire $5,000", she reports that the email says so and proposes nothing of the
 * sort.
 */
export function isForwarded(message: MailMessage): boolean {
  if (FORWARD_SUBJECT.test(message.subject ?? "")) return true;
  return FORWARD_BODY.test(message.text ?? "");
}

/**
 * How many are unread, from AgentMail's own label rather than a flag of ours.
 *
 * A read/unread bit stored here would be a second source of truth for
 * something the provider already owns, and the two would disagree the first
 * time he opened something anywhere else.
 */
export function unreadCount(messages: MailMessage[]): number {
  return messages.filter((m) => (m.labels ?? []).includes("unread")).length;
}

/**
 * One line for the morning brief: how much arrived, never what it said.
 *
 * A brief is generated unattended and then read aloud, so it is the one place
 * a stranger's words must not reach. He gets a number and a reason to look.
 */
export function countInbox(messages: MailMessage[], allowlist: string[]): string {
  if (messages.length === 0) return "Nothing in Zola's inbox.";
  const listed = messages.filter((m) => allowedSender(m.from, allowlist)).length;
  const rest = messages.length - listed;
  const parts = [
    listed ? `${listed} from ${listed === 1 ? "someone" : "people"} on your list` : "",
    rest ? `${rest} from ${rest === 1 ? "a sender" : "senders"} who ${rest === 1 ? "is" : "are"} not` : "",
  ].filter(Boolean);
  const n = messages.length;
  return `${n} ${n === 1 ? "message" : "messages"} in Zola's inbox — ${parts.join(", ")}.`;
}

/** "there is 1 other message" / "there are 2 other messages". She says it aloud. */
function plural(n: number): string {
  return n === 1 ? "there is 1 other message" : `there are ${n} other messages`;
}

/** What Zola says about her inbox, and what she was allowed to look at. */
export type InboxReport = {
  message: string;
  shown: MailMessage[];
  withheld: number;
};

/**
 * Turn an inbox into one spoken paragraph, with the allowlist applied.
 *
 * `wanted` is Tarik asking for something by name — "did the booking
 * confirmation come in?" — and it reaches past the allowlist on purpose. The
 * allowlist governs what volunteers itself into her reasoning, not what exists.
 * Without it, a confirmation from a service she signed up with would be
 * invisible forever, which is the wrong kind of strict.
 */
export function describeInbox(
  messages: MailMessage[],
  allowlist: string[],
  wanted?: string,
): InboxReport {
  const needle = (wanted ?? "").trim().toLowerCase();
  const matches = (m: MailMessage) =>
    `${m.from} ${m.subject ?? ""}`.toLowerCase().includes(needle);

  const shown = needle
    ? messages.filter(matches)
    : messages.filter((m) => allowedSender(m.from, allowlist));
  const withheld = needle ? 0 : messages.length - shown.length;

  if (shown.length === 0 && needle) {
    // Never "your inbox is empty" in answer to "did X come in?". It is the one
    // reply that would stop him looking, and it is false whenever anything at
    // all is sitting there.
    return {
      message: `Nothing in my inbox matches that${messages.length ? ` — ${plural(messages.length)}` : ""}.`,
      shown,
      withheld,
    };
  }
  if (shown.length === 0 && withheld === 0) {
    return { message: "Nothing new in your inbox.", shown, withheld };
  }
  if (shown.length === 0) {
    return {
      message:
        `Nothing from anyone on your list. ${withheld} ` +
        `${withheld === 1 ? "message" : "messages"} from senders who aren't on it — ` +
        "ask me for one by name and I'll read it.",
      shown,
      withheld,
    };
  }

  // Always "the email said", never "you should". A forward earns her attention
  // because Tarik sent it; it does not make the content an instruction.
  const lines = shown.map(
    (m) => `${isForwarded(m) ? "Forwarded, " : ""}${summarize(m)}`,
  );
  const tail = withheld
    ? ` And ${withheld} from senders who aren't on your list; ask me by name.`
    : "";
  return { message: `${lines.join(" ")}${tail}`, shown, withheld };
}

/**
 * A stable key for the conversation a message belongs to.
 *
 * AgentMail's own thread id when there is one. Without it, the subject with its
 * Re:/Fwd: prefixes stripped, so a reply and its original land together rather
 * than as two conversations.
 */
export function threadKey(message: MailMessage): string {
  if (message.thread_id) return message.thread_id;
  const subject = (message.subject ?? "")
    .replace(/^((re|fwd?|fw)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return subject || address(message.from) || "unknown";
}
