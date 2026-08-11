import { buildInboxQuery, type MuteList } from "../../convex/mailFilterLib.ts";
import { Composio } from "@composio/core";
import {
  CHICAGO_TZ,
  isoToChicagoNaive,
  naiveChicago,
  splitDuration,
} from "./calendarLib.ts";
import { chicagoToday } from "../../convex/workflowLib.ts";

// Google access goes through Composio: it holds the OAuth tokens (verified
// Google app — no consent-screen setup, no 7-day expiry) and supports
// multiple linked Google accounts (work + personal), each queried and
// labeled separately. Single Composio user id for this single-user app.
const USER_ID = "tarik";

// Lazy so importing this module (e.g. unit tests hitting only pure helpers)
// doesn't require COMPOSIO_API_KEY; the key is demanded on first real call.
let composioClient: Composio | null = null;
function composio(): Composio {
  composioClient ??= new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  return composioClient;
}

export class GoogleAuthError extends Error {}

export type Account = { id: string; label: string };

// Accounts change ~never in this single-user app; a short TTL removes the
// Composio list round trip from the front of every mail/calendar request.
const accountsCache = new Map<string, { at: number; accounts: Account[] }>();
const ACCOUNTS_TTL_MS = 60_000;

export async function connectedAccounts(toolkit: string): Promise<Account[]> {
  const hit = accountsCache.get(toolkit);
  if (hit && Date.now() - hit.at < ACCOUNTS_TTL_MS) return hit.accounts;
  const { items } = await composio().connectedAccounts.list({
    userIds: [USER_ID],
    toolkitSlugs: [toolkit],
  });
  const active = (items ?? []).filter((a) => a.status === "ACTIVE");
  if (active.length === 0) {
    throw new GoogleAuthError(
      `No ${toolkit === "gmail" ? "Gmail" : "Google Calendar"} account is connected — run the connect-google script and approve access`,
    );
  }
  const accounts = active.map((a) => ({
    id: a.id,
    label: (a as { alias?: string }).alias ?? a.id.slice(0, 8),
  }));
  accountsCache.set(toolkit, { at: Date.now(), accounts });
  return accounts;
}

// The one account-selection policy: exact label, then substring, else fail
// loud listing what's connected; no label prefers "work".
export async function pickAccount(
  toolkit: string,
  label?: string,
): Promise<Account> {
  const accounts = await connectedAccounts(toolkit);
  if (label) {
    const needle = label.toLowerCase();
    const hit =
      accounts.find((a) => a.label === label) ??
      accounts.find((a) => a.label.toLowerCase().includes(needle));
    if (!hit) {
      const noun = toolkit === "gmail" ? "Gmail" : "calendar";
      throw new Error(
        `No ${noun} account matches "${label}" — connected: ${accounts.map((a) => a.label).join(", ")}`,
      );
    }
    return hit;
  }
  return (
    accounts.find((a) => a.label.toLowerCase().includes("work")) ?? accounts[0]
  );
}

export async function execute(
  slug: string,
  connectedAccountId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await composio().tools.execute(slug, {
    userId: USER_ID,
    connectedAccountId,
    arguments: args,
    // ponytail: track latest toolkit versions; pin versions if a Composio
    // release ever changes a response shape under us.
    dangerouslySkipVersionCheck: true,
  });
  if (!result.successful) {
    const error = String(result.error ?? "unknown error");
    if (/auth|token|expired|unauthorized/i.test(error)) {
      throw new GoogleAuthError(
        "Google connection needs re-authorization — run the connect-google script again",
      );
    }
    throw new Error(`${slug} failed: ${error}`);
  }
  return (result.data ?? {}) as Record<string, unknown>;
}

export type CalendarEvent = {
  account: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
};

type RawDayEvent = CalendarEvent & { eventId: string; accountId: string };

async function listDayRaw(day: string): Promise<RawDayEvent[]> {
  const accounts = await connectedAccounts("googlecalendar");
  const perAccount = await Promise.all(
    accounts.map(async ({ id, label }) => {
      const data = await execute("GOOGLECALENDAR_EVENTS_LIST", id, {
        calendar_id: "primary",
        // ponytail: fixed -06:00 window predates this refactor; in CDT it
        // shifts the day edge by an hour (also bounds what update can match).
        // Switch to real Chicago-offset rendering if an edge event ever hides.
        time_min: `${day}T00:00:00-06:00`,
        time_max: `${day}T23:59:59-06:00`,
        single_events: true,
        order_by: "startTime",
        max_results: 20,
      });
      type Item = {
        id?: string;
        summary?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      };
      const items = ((data.items ?? data.events ?? []) as Item[]) ?? [];
      return items.map((e) => ({
        eventId: e.id ?? "",
        accountId: id,
        account: label,
        title: e.summary ?? "(untitled)",
        start: e.start?.dateTime ?? e.start?.date ?? "",
        end: e.end?.dateTime ?? e.end?.date ?? "",
        allDay: !e.start?.dateTime,
        location: e.location,
      }));
    }),
  );
  return perAccount.flat().sort((a, b) => a.start.localeCompare(b.start));
}

export async function getCalendarEvents(date?: string): Promise<{
  date: string;
  events: CalendarEvent[];
}> {
  const day = date ?? chicagoToday();
  const raw = await listDayRaw(day);
  return {
    date: day,
    events: raw.map(({ eventId: _i, accountId: _a, ...event }) => event),
  };
}

// ---- Calendar writes (MOO-491). Confirm-before-write lives in the persona;
// these never delete and never email attendees unless attendees are given. ----

function pickCalendarAccount(label?: string): Promise<Account> {
  return pickAccount("googlecalendar", label);
}

export async function createCalendarEvent(args: {
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  location?: string;
  description?: string;
  attendees?: string[];
  account?: string;
}): Promise<{ account: string }> {
  const acct = await pickCalendarAccount(args.account);
  const { hours, minutes } = splitDuration(args.durationMinutes);
  await execute("GOOGLECALENDAR_CREATE_EVENT", acct.id, {
    calendar_id: "primary",
    summary: args.title,
    start_datetime: naiveChicago(args.date, args.time),
    timezone: CHICAGO_TZ,
    event_duration_hour: hours,
    event_duration_minutes: minutes,
    ...(args.location ? { location: args.location } : {}),
    ...(args.description ? { description: args.description } : {}),
    // send_updates is documented as boolean but validated as an enum.
    ...(args.attendees && args.attendees.length > 0
      ? { attendees: args.attendees, send_updates: "all" }
      : { send_updates: "none" }),
  });
  return { account: acct.label };
}

type UpdateEventResult =
  | { outcome: "updated"; title: string; start: string; account: string }
  | { outcome: "ambiguous"; candidates: string[] }
  | { outcome: "not_found" };

export async function updateCalendarEventByMatch(args: {
  match: string;
  date: string;
  newDate?: string;
  newTime?: string;
  newDurationMinutes?: number;
  newTitle?: string;
  account?: string;
}): Promise<UpdateEventResult> {
  const needle = args.match.toLowerCase();
  // A bad account label fails loud here (listing the real ones) instead of
  // degrading into a misleading not_found.
  const acct = args.account ? await pickCalendarAccount(args.account) : null;
  // All-day events are excluded: moving them needs date semantics v1 skips.
  const hits = (await listDayRaw(args.date)).filter(
    (e) =>
      !e.allDay &&
      e.title.toLowerCase().includes(needle) &&
      (!acct || e.accountId === acct.id),
  );
  if (hits.length === 0) return { outcome: "not_found" };
  if (hits.length > 1) {
    return {
      outcome: "ambiguous",
      candidates: hits
        .slice(0, 4)
        .map((h) => `${h.title} at ${isoToChicagoNaive(h.start).slice(11, 16)} (${h.account})`),
    };
  }
  const hit = hits[0];
  const origNaive = isoToChicagoNaive(hit.start);
  const date = args.newDate ?? origNaive.slice(0, 10);
  const time = args.newTime ?? origNaive.slice(11, 16);
  // Keep the event's current length unless a new one was asked for — UPDATE
  // with no duration would let Google pick a default and silently resize.
  const currentMinutes =
    hit.end && hit.start
      ? Math.round((Date.parse(hit.end) - Date.parse(hit.start)) / 60000)
      : 60;
  const duration = splitDuration(args.newDurationMinutes ?? currentMinutes);
  await execute("GOOGLECALENDAR_UPDATE_EVENT", hit.accountId, {
    calendar_id: "primary",
    event_id: hit.eventId,
    // UPDATE requires start_datetime even for title-only edits.
    start_datetime: naiveChicago(date, time),
    timezone: CHICAGO_TZ,
    summary: args.newTitle ?? hit.title,
    event_duration_hour: duration.hours,
    event_duration_minutes: duration.minutes,
    send_updates: "none",
  });
  return {
    outcome: "updated",
    title: args.newTitle ?? hit.title,
    start: `${date} ${time}`,
    account: hit.account,
  };
}

export type EmailSummary = {
  account: string;
  from: string;
  subject: string;
  snippet: string;
  threadId?: string;
};

/**
 * Recent mail, with muted senders and subjects excluded AT GMAIL.
 *
 * The mute list is applied in the query rather than to the results on purpose.
 * Six messages are requested per account; four of Tarik's were automated
 * pipeline reports, so filtering afterwards would fix the panel and still let
 * the noise eat the whole budget. Excluded in the query, a muted message never
 * costs a slot, never reaches the brief, and is never read out by Zola.
 *
 * The list is passed in rather than read here: this file has no Convex client,
 * and both callers already have one.
 */
export async function getRecentEmails(mutes?: MuteList): Promise<EmailSummary[]> {
  const accounts = await connectedAccounts("gmail");
  const query = buildInboxQuery(mutes ?? { senders: [], subjects: [] });
  const perAccount = await Promise.all(
    accounts.map(async ({ id, label }) => {
      const data = await execute("GMAIL_FETCH_EMAILS", id, {
        query,
        max_results: 6,
      });
      type Msg = {
        sender?: string;
        from?: string;
        subject?: string;
        preview?: { subject?: string };
        messageText?: string;
        snippet?: string;
        threadId?: string;
        thread_id?: string;
      };
      const messages = ((data.messages ?? []) as Msg[]) ?? [];
      return messages.map((m) => ({
        account: label,
        from: String(m.sender ?? m.from ?? "").replace(/<.*>/, "").trim(),
        subject: String(m.subject ?? m.preview?.subject ?? ""),
        snippet: String(m.snippet ?? m.messageText ?? "").slice(0, 160),
        threadId: m.threadId ?? m.thread_id ?? undefined,
      }));
    }),
  );
  return perAccount.flat();
}
