import { connectedAccounts, execute } from "./google.ts";
import { sanitizeEmailHtml } from "./mailSanitizer.ts";

// Mail center data layer (MOO-492): thread list + full-thread read across
// the connected Gmail accounts. Server-side only — sibling of google.ts.
// Composio response shapes vary by release; every mapping is defensive.

export type MailThreadRow = {
  threadId: string;
  account: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
};

export type MailMessage = {
  from: string;
  to: string;
  date: string;
  subject: string;
  // Sanitized HTML, ready for a sandboxed iframe.
  html: string;
  sanitizerFallback: boolean;
};

type RawMsg = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function pickBody(m: RawMsg): { html: string; isHtml: boolean } {
  const payload = (m.payload ?? {}) as RawMsg;
  const html =
    str(m.messageHtml) || str(m.htmlBody) || str(payload.htmlBody) || "";
  if (html) return { html, isHtml: true };
  const text = str(m.messageText) || str(m.snippet) || "";
  return { html: text, isHtml: false };
}

function timestamp(m: RawMsg): string {
  return str(m.messageTimestamp) || str(m.date) || str(m.internalDate) || "";
}

export async function listMailThreads(
  accountLabel?: string,
): Promise<{ threads: MailThreadRow[]; accounts: string[] }> {
  const accounts = await connectedAccounts("gmail");
  const wanted = accountLabel
    ? accounts.filter((a) =>
        a.label.toLowerCase().includes(accountLabel.toLowerCase()),
      )
    : accounts;
  const perAccount = await Promise.all(
    wanted.map(async ({ id, label }) => {
      const data = await execute("GMAIL_FETCH_EMAILS", id, {
        query: "in:inbox newer_than:7d",
        max_results: 25,
      });
      const messages = ((data.messages ?? []) as RawMsg[]) ?? [];
      return messages.map((m) => ({
        threadId: str(m.threadId) || str(m.thread_id),
        account: label,
        from: str(m.sender ?? m.from).replace(/<.*>/, "").trim(),
        subject: str(m.subject) || "(no subject)",
        snippet: str(m.snippet ?? m.messageText).slice(0, 140),
        date: timestamp(m),
      }));
    }),
  );
  // One row per thread, newest first.
  const seen = new Set<string>();
  const threads = perAccount
    .flat()
    .filter((t) => t.threadId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((t) =>
      seen.has(`${t.account}:${t.threadId}`)
        ? false
        : (seen.add(`${t.account}:${t.threadId}`), true),
    );
  return { threads, accounts: accounts.map((a) => a.label) };
}

export async function getMailThread(
  threadId: string,
  accountLabel: string,
): Promise<MailMessage[]> {
  const accounts = await connectedAccounts("gmail");
  const account =
    accounts.find((a) => a.label === accountLabel) ??
    accounts.find((a) =>
      a.label.toLowerCase().includes(accountLabel.toLowerCase()),
    );
  if (!account) {
    throw new Error(
      `No Gmail account matches "${accountLabel}" — connected: ${accounts.map((a) => a.label).join(", ")}`,
    );
  }
  const data = await execute("GMAIL_FETCH_MESSAGE_BY_THREAD_ID", account.id, {
    thread_id: threadId,
  });
  const messages = ((data.messages ?? []) as RawMsg[]) ?? [];
  return messages.map((m) => {
    const body = pickBody(m);
    const sanitized = body.isHtml
      ? sanitizeEmailHtml(body.html)
      : { html: `<pre style="white-space:pre-wrap;font-family:inherit">${body.html.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre>`, fallback: false };
    return {
      from: str(m.sender ?? m.from).trim(),
      to: str(m.to ?? m.recipient).trim(),
      date: timestamp(m),
      subject: str(m.subject),
      html: sanitized.html,
      sanitizerFallback: sanitized.fallback,
    };
  });
}
