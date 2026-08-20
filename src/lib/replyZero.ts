// The threads somebody left with him.
//
// Every other mail tool reads or drafts. None of them notice that Valeria
// wrote on Tuesday and nobody ever answered. This is the one that notices.
//
// THE SHAPE OF THE PROBLEM: `in:inbox` never returns Tarik's own messages —
// a sent message carries the SENT label and not INBOX, so the newest message
// the inbox query can see for any thread is always one he RECEIVED. Ask only
// the inbox and a thread he answered from his phone still looks unanswered,
// and a tool that cries wolf gets ignored.
//
// So we ask twice — `in:inbox` and `in:sent` — and join on threadId. Verified
// against the live Composio GMAIL_FETCH_EMAILS response 2026-08-13: both
// queries return the same shape, both carry `threadId`, and both carry
// `messageTimestamp` as ISO-8601 Z. In that sample, thread 19ffc728a12b87c3
// sat in the inbox results with a sent reply 63 seconds newer — the exact
// false positive the single-query version would have spoken aloud.
//
// No Composio import on purpose: tests/replyZero.test.ts imports this file
// directly under `node --test`. The two API calls live in the tool route.
// Same split as src/lib/lede.ts and src/lib/zolaReply.ts.

/**
 * Seven days of inbox, primary only, with the mute list applied on top.
 *
 * Wider than the panel's `newer_than:1d` because a thread has to sit a while
 * before it is worth mentioning, and narrower than forever because Gmail's
 * own `newer_than` is the cheapest possible cap.
 */
export const REPLY_ZERO_INBOX_BASE = "in:inbox category:primary newer_than:7d";

/** The other half of the join. No mutes: a muted thread has no inbound leg. */
export const REPLY_ZERO_SENT_QUERY = "in:sent newer_than:7d";

/**
 * How long a thread must sit before it counts as sitting.
 *
 * Under a day is not a neglected thread, it is today's mail, and `get_emails`
 * already reads that out. Twenty-four hours is the line where "I saw it" turns
 * into "I forgot it".
 */
export const SITTING_AFTER_HOURS = 24;

/** How many the spoken sentence names before it stops. */
export const SPOKEN_LIMIT = 3;

/**
 * Messages per query, per account.
 *
 * Truncation is asymmetric. A truncated INBOX leg means a sitting thread goes
 * unmentioned — quiet, and recoverable tomorrow. A truncated SENT leg means a
 * thread he already answered gets read out as unanswered, which is the one
 * failure that makes the whole tool ignorable. So this is sized for the sent
 * leg's headroom (21 sent messages in the measured week) and the inbox leg
 * takes the same number.
 */
export const REPLY_ZERO_MAX_RESULTS = 100;

/** A raw RFC header off `payload.headers`. */
export type MailHeader = { name?: string; value?: string };

/** One message off either query, already flattened. */
export type ReplyZeroMessage = {
  threadId: string;
  account: string;
  /** Display name of whoever sent it — this is the part that gets spoken. */
  from: string;
  /** The unstripped `Name <addr@host>`, because the broadcast test needs it. */
  address?: string;
  subject: string;
  /** ISO-8601, or anything Date.parse understands. Unparseable is dropped. */
  date: string;
  /** RFC headers, for the broadcast test. Absent is treated as "not bulk". */
  headers?: MailHeader[];
};

/**
 * Headers a broadcast sets and a person does not.
 *
 * `List-Unsubscribe` and `List-ID` are RFC 2369 mailing-list markers,
 * `Precedence: bulk|list` is the old convention, and `Auto-Submitted` is
 * RFC 3834 for anything a machine generated. All four are the SENDER
 * declaring what this is — which is why this is a fact about the message and
 * not a guess about the sender.
 */
const BULK_HEADERS = /^(list-unsubscribe|list-id|list-post|precedence|auto-submitted)$/i;

/**
 * Addresses that cannot receive a reply.
 *
 * Deliberately narrow. Every pattern here is a mailbox that by construction
 * discards what you send it, so a thread from one cannot be awaiting your
 * answer. Anything broader starts guessing about real people — `notifications@`
 * is somebody's real support queue often enough to leave alone, and the ones
 * that truly are robots set the headers above anyway.
 */
const NO_REPLY_ADDRESS = /(^|[<.\s_-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([.\s_-]|@)/i;

/**
 * Is this a broadcast rather than correspondence?
 *
 * Verified against two days of the real inbox 2026-08-13: this caught the
 * pipeline reports, the promo blasts, the Google Groups traffic and the PR
 * lists, and left every genuine human thread standing. What it does NOT catch
 * is the mailing list that sets no headers at all — that is what the mute list
 * is for, and pretending otherwise here would mean guessing.
 */
export function isBroadcast(m: {
  from?: string;
  address?: string;
  headers?: MailHeader[];
}): boolean {
  for (const h of m.headers ?? []) {
    if (BULK_HEADERS.test(h?.name ?? "")) return true;
  }
  return NO_REPLY_ADDRESS.test(m.address ?? m.from ?? "");
}

export type Direction = "awaiting_you" | "awaiting_them";

export type SittingThread = {
  threadId: string;
  account: string;
  /** The other party — the person on the far end of the thread. */
  who: string;
  subject: string;
  /** ISO-8601 of the message that started the wait. */
  since: string;
  hoursWaiting: number;
  direction: Direction;
};

type Leg = { date: number; iso: string; from: string; subject: string };

function parsed(m: ReplyZeroMessage): Leg | null {
  const date = Date.parse(m.date);
  if (!Number.isFinite(date)) return null;
  return { date, iso: m.date, from: m.from, subject: m.subject };
}

function newest(a: Leg | null, b: Leg | null): Leg | null {
  if (!a) return b;
  if (!b) return a;
  return b.date > a.date ? b : a;
}

/**
 * Threads with an unanswered end, oldest wait first.
 *
 * A thread needs an INBOUND leg from a person to qualify at all. That one rule
 * does three jobs: it drops cold outbound (every one-off note he never expected
 * an answer to, which would otherwise bury the real ones), it drops broadcasts
 * (see isBroadcast — the first live run without this said eighteen threads were
 * waiting on him and named three database pipeline reports), and it means the
 * mute list applied to the inbox query alone keeps muted senders out of both
 * directions.
 */
export function findSittingThreads(input: {
  inbox: ReplyZeroMessage[];
  sent: ReplyZeroMessage[];
  now: number;
  minHours?: number;
}): SittingThread[] {
  const minHours = input.minHours ?? SITTING_AFTER_HOURS;
  const inbound = new Map<string, Leg>();
  const outbound = new Map<string, Leg>();
  const account = new Map<string, string>();

  for (const [rows, into] of [
    [input.inbox, inbound],
    [input.sent, outbound],
  ] as const) {
    for (const m of rows) {
      if (!m.threadId) continue;
      // Broadcasts are dropped on the inbound leg only: his own sent mail is
      // correspondence whatever headers it carries, and dropping a sent leg
      // would resurrect an answered thread as unanswered.
      if (into === inbound && isBroadcast(m)) continue;
      const leg = parsed(m);
      if (!leg) continue;
      const key = `${m.account}:${m.threadId}`;
      const merged = newest(into.get(key) ?? null, leg);
      if (merged) into.set(key, merged);
      account.set(key, m.account);
    }
  }

  const out: SittingThread[] = [];
  for (const [key, they] of inbound) {
    const he = outbound.get(key) ?? null;
    const answered = he !== null && he.date > they.date;
    // Waiting on them only counts once they have written at least once —
    // that is what the inbound-required rule above already guarantees.
    const leg = answered ? he : they;
    const hoursWaiting = (input.now - leg.date) / 3_600_000;
    if (hoursWaiting < minHours) continue;
    out.push({
      threadId: key.slice(key.indexOf(":") + 1),
      account: account.get(key) ?? "",
      who: they.from,
      subject: they.subject || "(no subject)",
      since: leg.iso,
      hoursWaiting: Math.round(hoursWaiting),
      direction: answered ? "awaiting_them" : "awaiting_you",
    });
  }
  return out.sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

/** How long it has been, said the way a person says it. */
export function describeWait(hours: number): string {
  const days = Math.floor(hours / 24);
  if (days <= 0) return "since earlier today";
  if (days === 1) return "a day now";
  if (days < 7) return `${days} days now`;
  return "over a week";
}

/**
 * What Zola says out loud.
 *
 * Threads awaiting HIM lead, because those are the ones he can act on; the
 * ones he is waiting on are a trailing clause, not their own sentence.
 */
export function speakSitting(threads: SittingThread[]): string {
  const yours = threads.filter((t) => t.direction === "awaiting_you");
  const theirs = threads.filter((t) => t.direction === "awaiting_them");

  if (yours.length === 0 && theirs.length === 0)
    return "Nothing sitting — every thread from the past week has an answer on it.";

  const tail =
    theirs.length === 0
      ? ""
      : ` You're waiting on ${theirs.length} other${theirs.length === 1 ? "" : "s"}.`;

  if (yours.length === 0)
    return `Nothing waiting on you.${tail}`.replace("  ", " ").trim();

  const named = yours
    .slice(0, SPOKEN_LIMIT)
    .map((t) => `${t.who} on "${t.subject}", ${describeWait(t.hoursWaiting)}`)
    .join("; ");
  const more =
    yours.length > SPOKEN_LIMIT ? `, and ${yours.length - SPOKEN_LIMIT} more` : "";
  const count =
    yours.length === 1
      ? "One thread is waiting on you"
      : `${yours.length} threads are waiting on you`;
  return `${count}: ${named}${more}.${tail}`;
}
