import {
  connectedAccounts,
  execute,
  pickAccount,
  type Account,
} from "./google.ts";
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

export type DraftRow = {
  draftId: string;
  account: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  threadId?: string;
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

// ---- Drafts + send (MOO-493). Gmail-native drafts; no update action exists,
// so replace = delete + create. Send is explicit and atomic (SEND_DRAFT). ----

// Pure mapping for GMAIL_LIST_DRAFTS verbose rows (shape probed live 2026-08-07:
// { id, message: { subject, to, sender, messageTimestamp, threadId, messageText } }).
export function mapDraftRows(rows: RawMsg[], account: string): DraftRow[] {
  return rows
    .filter((d) => str(d.id))
    .map((d) => {
      const m = (d.message ?? {}) as RawMsg;
      const threadId = str(m.threadId) || str(m.thread_id);
      return {
        draftId: str(d.id),
        account,
        to: str(m.to ?? m.recipient),
        subject: str(m.subject) || "(no subject)",
        snippet: str(m.messageText ?? m.snippet).slice(0, 140),
        date: timestamp(m),
        ...(threadId ? { threadId } : {}),
      };
    });
}

export type DraftInput = {
  to: string;
  subject: string;
  bodyHtml: string;
  account?: string;
  threadId?: string;
};

async function createDraftFor(
  acct: Account,
  input: DraftInput,
): Promise<{ draftId: string; account: string }> {
  const data = await execute("GMAIL_CREATE_EMAIL_DRAFT", acct.id, {
    recipient_email: input.to,
    subject: input.subject,
    body: input.bodyHtml,
    is_html: true,
    ...(input.threadId ? { thread_id: input.threadId } : {}),
  });
  const draftId = str(data.id);
  if (!draftId) throw new Error("Draft created but no draft id returned");
  return { draftId, account: acct.label };
}

// Creates a real Gmail draft; threadId makes it a draft-first reply
// (thread_id support confirmed with a real call, 2026-08-07).
export async function createDraft(
  input: DraftInput,
): Promise<{ draftId: string; account: string }> {
  return createDraftFor(await pickAccount("gmail", input.account), input);
}

// No draft-update action exists: replace = delete + create. If create fails
// after delete, the caller (editor) still holds the content and retries —
// the error is surfaced, nothing is swallowed.
export async function replaceDraft(
  oldDraftId: string,
  input: DraftInput,
): Promise<{ draftId: string; account: string }> {
  const acct = await pickAccount("gmail", input.account);
  await execute("GMAIL_DELETE_DRAFT", acct.id, { draft_id: oldDraftId });
  return createDraftFor(acct, input);
}

// Fans out over every connected account (same shape as listMailThreads) so
// personal drafts aren't silently hidden; optional label narrows it.
export async function listDrafts(accountLabel?: string): Promise<DraftRow[]> {
  const accounts = await connectedAccounts("gmail");
  const wanted = accountLabel
    ? accounts.filter((a) =>
        a.label.toLowerCase().includes(accountLabel.toLowerCase()),
      )
    : accounts;
  const perAccount = await Promise.all(
    wanted.map(async ({ id, label }) => {
      const data = await execute("GMAIL_LIST_DRAFTS", id, {
        max_results: 25,
        verbose: true,
      });
      return mapDraftRows((data.drafts ?? []) as RawMsg[], label);
    }),
  );
  return perAccount.flat().sort((a, b) => b.date.localeCompare(a.date));
}

// The ONLY send path in the app — always from an existing draft, always
// caller-initiated. Zola's tool surface must never reach this (MOO-494).
export async function sendDraft(
  draftId: string,
  accountLabel?: string,
): Promise<void> {
  const acct = await pickAccount("gmail", accountLabel);
  await execute("GMAIL_SEND_DRAFT", acct.id, { draft_id: draftId });
}

export async function getMailThread(
  threadId: string,
  accountLabel: string,
): Promise<MailMessage[]> {
  const account = await pickAccount("gmail", accountLabel);
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
