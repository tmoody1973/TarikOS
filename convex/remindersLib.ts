// Reminders: the pure half, decided without a database or a clock.
//
// A reminder is a promise to interrupt someone later. That shapes every rule
// here: a promise that fires at the wrong time, or fires instantly because a
// spoken time was mis-parsed, is worse than no promise at all. So the refusals
// are deliberately loud and the fallbacks deliberately quiet.
//
// Lives in convex/ because both the scheduler (Convex) and the tool route
// (Next) need the same answers, and Convex functions cannot import from src/.

export const CHICAGO_TZ = "America/Chicago";

/**
 * How a reminder reaches him.
 *
 * Telegram is the default: it costs nothing and interrupts least.
 *
 * A phone call is deliberately NOT a channel. Zola can already ring him, but
 * that path is guarded by three tests asserting there is exactly one dialling
 * site in the codebase and that its destination is not a parameter anywhere. A
 * second one would have to be reviewed on purpose rather than inherited here,
 * and a reminder is not worth loosening the rail that keeps her from dialling
 * anything but OWNER_PHONE. `channelOf` sends "call me" to Telegram and
 * `remind_me` says so out loud, because a channel that quietly becomes another
 * channel is how someone stops trusting the feature.
 */
export const REMINDER_CHANNELS = ["telegram", "email"] as const;

export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/** Far enough ahead to be a plan, near enough to be a real intention. */
const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** Enough to say what to do, not enough to be a document. */
const TEXT_MAX = 400;

/**
 * Chicago's offset from UTC at a given instant, in milliseconds.
 *
 * Computed rather than hardcoded, because the offset moves twice a year and a
 * reminder set in October for November is exactly the case a fixed -5 or -6
 * gets wrong by an hour.
 *
 * The trick: format the instant as Chicago wall time, then read those numbers
 * back as though they were UTC. The gap between that and the real instant IS
 * the offset.
 */
function chicagoOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instant));
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    num("year"),
    num("month") - 1,
    num("day"),
    // Some engines render midnight as hour 24 under hour12:false.
    num("hour") % 24,
    num("minute"),
    num("second"),
  );
  return asIfUtc - instant;
}

/**
 * A naive local time ("2026-08-12T09:30:00") as a real instant.
 *
 * Two passes on purpose. The first uses the offset at the wrong instant, which
 * is right except within an hour of a DST transition; the second uses the
 * offset at the approximately-right instant and settles it.
 */
export function chicagoToUtc(naive: string): number {
  const asIfUtc = Date.parse(`${naive.replace(/[Zz]|[+-]\d{2}:?\d{2}$/, "")}Z`);
  if (Number.isNaN(asIfUtc)) return NaN;
  const first = asIfUtc - chicagoOffsetMs(asIfUtc);
  return asIfUtc - chicagoOffsetMs(first);
}

/**
 * A reminder, or a reason there isn't one.
 *
 * `when` is a naive local datetime the agent computed, the same shape the
 * calendar tools already take. Every refusal below is a mis-parse rather than a
 * thing Tarik would plausibly have asked for.
 */
export function reminderAt(
  text: string,
  when: string,
  now: number,
): { ok: true; text: string; dueAt: number } | { ok: false; error: string } {
  const clean = (text ?? "").trim().slice(0, TEXT_MAX);
  if (!clean) return { ok: false, error: "What should I remind you about?" };

  const dueAt = chicagoToUtc(when ?? "");
  if (Number.isNaN(dueAt)) {
    return { ok: false, error: "I didn't catch when. Say a day and a time." };
  }
  // A time already gone means the model mis-heard, not that he wanted an
  // instant interruption. Firing anyway makes a mis-hearing look like the
  // feature working.
  if (dueAt <= now) {
    return { ok: false, error: "That time has already passed. When should I remind you?" };
  }
  if (dueAt - now > MAX_AHEAD_MS) {
    return { ok: false, error: "That's more than a year out. Did I hear the date right?" };
  }
  return { ok: true, text: clean, dueAt };
}

/**
 * Which channel he meant.
 *
 * Anything unrecognised becomes Telegram rather than an error. A reminder that
 * arrives the wrong way still arrives; one that throws on an unexpected word is
 * a reminder that silently never happens.
 */
export function channelOf(said: string | undefined): ReminderChannel {
  const word = (said ?? "").toLowerCase();
  if (/email|mail/.test(word)) return "email";
  return "telegram";
}

/** True when he asked to be phoned and will be texted instead. Said out loud. */
export function askedForACall(said: string | undefined): boolean {
  return /call|phone|ring/.test((said ?? "").toLowerCase());
}

/** A time as Tarik hears it: his own timezone, spoken. */
export function spokenTime(instant: number): string {
  return new Date(instant).toLocaleString("en-US", {
    timeZone: CHICAGO_TZ,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** What is still coming, as a sentence. She speaks this. */
export function describeReminders(
  pending: { text: string; dueAt: number }[],
): string {
  if (pending.length === 0) return "You have no reminders set.";
  const soonest = [...pending].sort((a, z) => a.dueAt - z.dueAt).slice(0, 5);
  return soonest.map((r) => `${r.text}, ${spokenTime(r.dueAt)}`).join("; ") + ".";
}

/**
 * The reminders a spoken quote could mean. Every candidate, never a pick.
 *
 * An empty quote matches nothing: otherwise one dropped word in transcription
 * cancels every pending reminder at once.
 */
export function matchReminders<T extends { text: string }>(
  reminders: T[],
  quote: string,
): T[] {
  const needle = comparable(quote);
  if (!needle) return [];
  return reminders.filter((r) => comparable(r.text).includes(needle));
}

function comparable(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
