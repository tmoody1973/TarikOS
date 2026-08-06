import { Composio } from "@composio/core";

// Google access goes through Composio: it holds the OAuth tokens (verified
// Google app — no consent-screen setup, no 7-day expiry) and supports
// multiple linked Google accounts (work + personal), each queried and
// labeled separately. Single Composio user id for this single-user app.
const USER_ID = "tarik";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

export class GoogleAuthError extends Error {}

type Account = { id: string; label: string };

async function connectedAccounts(toolkit: string): Promise<Account[]> {
  const { items } = await composio.connectedAccounts.list({
    userIds: [USER_ID],
    toolkitSlugs: [toolkit],
  });
  const active = (items ?? []).filter((a) => a.status === "ACTIVE");
  if (active.length === 0) {
    throw new GoogleAuthError(
      `No ${toolkit === "gmail" ? "Gmail" : "Google Calendar"} account is connected — run the connect-google script and approve access`,
    );
  }
  return active.map((a) => ({
    id: a.id,
    label: (a as { alias?: string }).alias ?? a.id.slice(0, 8),
  }));
}

async function execute(
  slug: string,
  connectedAccountId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await composio.tools.execute(slug, {
    userId: USER_ID,
    connectedAccountId,
    arguments: args,
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

export async function getCalendarEvents(date?: string): Promise<{
  date: string;
  events: CalendarEvent[];
}> {
  const day =
    date ??
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
    }).format(new Date());

  const accounts = await connectedAccounts("googlecalendar");
  const perAccount = await Promise.all(
    accounts.map(async ({ id, label }) => {
      const data = await execute("GOOGLECALENDAR_EVENTS_LIST", id, {
        calendar_id: "primary",
        time_min: `${day}T00:00:00-06:00`,
        time_max: `${day}T23:59:59-06:00`,
        single_events: true,
        order_by: "startTime",
        max_results: 20,
      });
      type Item = {
        summary?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      };
      const items = ((data.items ?? data.events ?? []) as Item[]) ?? [];
      return items.map((e) => ({
        account: label,
        title: e.summary ?? "(untitled)",
        start: e.start?.dateTime ?? e.start?.date ?? "",
        end: e.end?.dateTime ?? e.end?.date ?? "",
        allDay: !e.start?.dateTime,
        location: e.location,
      }));
    }),
  );

  return {
    date: day,
    events: perAccount.flat().sort((a, b) => a.start.localeCompare(b.start)),
  };
}

export type EmailSummary = {
  account: string;
  from: string;
  subject: string;
  snippet: string;
};

export async function getRecentEmails(): Promise<EmailSummary[]> {
  const accounts = await connectedAccounts("gmail");
  const perAccount = await Promise.all(
    accounts.map(async ({ id, label }) => {
      const data = await execute("GMAIL_FETCH_EMAILS", id, {
        query: "in:inbox category:primary newer_than:1d",
        max_results: 6,
      });
      type Msg = {
        sender?: string;
        from?: string;
        subject?: string;
        preview?: { subject?: string };
        messageText?: string;
        snippet?: string;
      };
      const messages = ((data.messages ?? []) as Msg[]) ?? [];
      return messages.map((m) => ({
        account: label,
        from: String(m.sender ?? m.from ?? "").replace(/<.*>/, "").trim(),
        subject: String(m.subject ?? m.preview?.subject ?? ""),
        snippet: String(m.snippet ?? m.messageText ?? "").slice(0, 160),
      }));
    }),
  );
  return perAccount.flat();
}
