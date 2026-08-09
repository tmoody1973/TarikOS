import {
  connectedAccounts,
  execute,
  pickAccount,
  type Account,
} from "./google.ts";
import { sanitizeEmailHtml } from "./mailSanitizer.ts";
import { extractEmailAddress } from "./emailAddress.ts";
import { tokenize } from "./briefArchive.ts";

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
  messageId?: string;
  // Carried when the list response already contains the body (our single-part
  // HTML drafts) so the editor can open without a second fetch.
  bodyHtml?: string;
};

type RawMsg = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
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
        snippet: previewSnippet(m),
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

// ---- Reply matching (MOO-494). Deliberately strict: every meaningful token
// must land in a thread's subject+sender. A wrong match drafts into the wrong
// conversation, so none/ambiguous always beats a guess. ----

const MATCH_STOPWORDS = new Set([
  "the", "a", "an", "email", "mail", "message", "thread", "from", "about",
  "to", "re", "reply", "that", "one", "my", "his", "her", "their", "this",
]);

export type ThreadMatch =
  | { outcome: "matched"; thread: MailThreadRow }
  | { outcome: "ambiguous"; candidates: MailThreadRow[] }
  | { outcome: "none" };

export function matchThread(
  rows: MailThreadRow[],
  query: string,
): ThreadMatch {
  const tokens = tokenize(query, MATCH_STOPWORDS);
  if (tokens.length === 0) return { outcome: "none" };
  const hits = rows.filter((r) => {
    const hay = `${r.subject} ${r.from}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  if (hits.length === 1) return { outcome: "matched", thread: hits[0] };
  if (hits.length > 1)
    return { outcome: "ambiguous", candidates: hits.slice(0, 3) };
  return { outcome: "none" };
}

// ---- Message body extraction (MOO-494, rebuilt for MOO-538). Shapes probed
// live 2026-08-09 across 25 real inbox messages: messageHtml, htmlBody,
// payload.htmlBody and snippet are NEVER present; messageText is always
// present and is sometimes the raw HTML source; and payload always carries a
// text/html part at depth 0..3. So the honest answer is "read the payload's
// text/html part" — that is the thing Gmail itself renders. ----

export type RawPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: RawPart[];
};

/** Depth-first search of the MIME tree. Real mail nests: multipart/mixed →
 *  multipart/alternative → text/html, and a bounce goes a level deeper still.
 *  A one-level scan drops those to the plain-text path with perfectly good
 *  markup sitting right there — that was the wall-of-text bug. */
export function findPart(
  part: RawPart | undefined,
  mimeType: string,
): RawPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType) return part;
  for (const child of part.parts ?? []) {
    const hit = findPart(child, mimeType);
    if (hit) return hit;
  }
  return undefined;
}

function decodeB64Html(part: RawPart | undefined): string {
  const data = part?.body?.data;
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

function escapeText(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Plain text → real paragraphs. A blank line starts a paragraph, a single
 *  newline is a break. One `<p>` around the whole body collapses every
 *  boundary, which is what a wall of text is. */
export function textToHtml(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeText(para).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

/** Render-ready body for one message. `isHtml` says whether it is real
 *  markup (the caller must sanitize it) or text we already escaped. */
export function messageBody(m: Record<string, unknown>): {
  html: string;
  isHtml: boolean;
} {
  const payload = (m.payload ?? {}) as RawPart;
  const direct =
    str(m.messageHtml) ||
    str(m.htmlBody) ||
    str((payload as RawMsg).htmlBody);
  if (direct) return { html: direct, isHtml: true };

  const html = decodeB64Html(findPart(payload, "text/html"));
  if (html) return { html, isHtml: true };

  // The MIME text/plain part before messageText: Composio's messageText is a
  // flattened rendering that can arrive with every newline stripped (measured
  // on the Great Lakes Distillery newsletter — 10,949 chars, zero newlines).
  const plainPart = decodeB64Html(findPart(payload, "text/plain"));
  if (plainPart) return { html: textToHtml(plainPart), isHtml: false };

  const text = str(m.messageText);
  if (text)
    return looksLikeHtml(text)
      ? { html: text, isHtml: true }
      : { html: textToHtml(text), isHtml: false };

  const bare = decodeB64Html(payload);
  return bare ? { html: textToHtml(bare), isHtml: false } : { html: "", isHtml: false };
}

export function extractMessageHtml(msg: Record<string, unknown>): string {
  return messageBody(msg).html;
}

// ---- List-row snippet. Gmail's own preview text rides in preview.body
// (present on 25/25 probed messages), entity-encoded and padded with the
// zero-width characters senders use to cut the inbox preview short. ----

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// One pass, so a decoded "&" can never be re-read as the start of an entity.
function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const e = entity.toLowerCase();
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
    return NAMED_ENTITIES[e] ?? match;
  });
}

// Soft hyphen, combining grapheme joiner, the ZWSP/ZWNJ/ZWJ/LRM/RLM block,
// word joiner, BOM — the padding that makes a preheader stop where the sender
// wants it to and reads as ragged whitespace anywhere else.
const ZERO_WIDTH = /[­͏​-‏⁠﻿]/g;

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  );
}

/** The one-line preview under the subject. Never markup: the row previously
 *  fell back to messageText, which for an HTML newsletter is the source. */
export function previewSnippet(m: Record<string, unknown>): string {
  const preview = (m.preview ?? {}) as RawMsg;
  const offered = str(preview.body) || str(m.snippet);
  const text = offered ? decodeEntities(offered) : htmlToText(messageBody(m).html);
  return text.replace(ZERO_WIDTH, " ").replace(/\s+/g, " ").trim().slice(0, 140);
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
      const messageId = str(m.messageId) || str(m.id);
      const text = str(m.messageText ?? m.snippet);
      return {
        draftId: str(d.id),
        account,
        to: str(m.to ?? m.recipient),
        subject: str(m.subject) || "(no subject)",
        snippet: previewSnippet(m),
        date: timestamp(m),
        ...(threadId ? { threadId } : {}),
        ...(messageId ? { messageId } : {}),
        ...(looksLikeHtml(text) ? { bodyHtml: text } : {}),
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

// Body HTML of any message (MOO-494; used to open drafts in the editor) —
// Gmail serves it via the message fetch, shapes handled by extractMessageHtml.
export async function getMessageHtml(
  messageId: string,
  accountLabel: string,
): Promise<string> {
  const acct = await pickAccount("gmail", accountLabel);
  const msg = await execute("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", acct.id, {
    message_id: messageId,
    format: "full",
  });
  return extractMessageHtml(msg);
}

// Reply resolution for draft-first replies (MOO-494) — calendar-write
// precedent: the lib returns an outcome union, the tool route only maps
// outcomes to spoken messages.
export type ReplyTarget =
  | {
      outcome: "resolved";
      to: string;
      subject: string;
      threadId: string;
      account: string;
      thread: MailMessage[];
    }
  | { outcome: "ambiguous"; candidates: MailThreadRow[] }
  | { outcome: "none" };

export async function resolveReplyTarget(
  replyMatch: string,
  accountLabel?: string,
): Promise<ReplyTarget> {
  const { threads } = await listMailThreads(accountLabel);
  const match = matchThread(threads, replyMatch);
  if (match.outcome !== "matched") return match;
  const t = match.thread;
  const thread = await getMailThread(t.threadId, t.account);
  const lastFrom = thread[thread.length - 1]?.from ?? "";
  return {
    outcome: "resolved",
    to: extractEmailAddress(lastFrom) ?? "",
    subject: t.subject.startsWith("Re:") ? t.subject : `Re: ${t.subject}`,
    threadId: t.threadId,
    account: t.account,
    thread,
  };
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
    // messageBody already escaped the plain-text path into paragraphs; only
    // real markup needs the sanitizer.
    const body = messageBody(m);
    const sanitized = body.isHtml
      ? sanitizeEmailHtml(body.html)
      : { html: body.html, fallback: false };
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
